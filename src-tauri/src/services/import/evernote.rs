use crate::services::prelude::*;
use crate::services::*;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvernotePaths {
    pub db_path: Option<String>,
    pub rte_root: Option<String>,
    pub resources_root: Option<String>,
}
#[tauri::command]
pub async fn select_evernote_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle.dialog().file().pick_folder(move |folder| {
        let path = folder.and_then(|value| value.into_path().ok());
        let _ = tx.send(path.map(|value| value.to_string_lossy().to_string()));
    });
    rx.await.map_err(|e| e.to_string())
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvernoteImportResult {
    notes: i64,
    notebooks: i64,
    tags: i64,
    attachments: i64,
}
#[tauri::command]
pub async fn import_evernote_from_json(
    json_path: String,
    assets_dir: String,
    state: State<'_, AppState>,
) -> Result<EvernoteImportResult, String> {
    let raw = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let stacks = data
        .get("stacks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let notebooks = data
        .get("notebooks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let notes = data
        .get("notes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tags = data
        .get("tags")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let note_tags = data
        .get("noteTags")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let attachments = data
        .get("attachments")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp();
    let pool = state.pool.clone();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM note_tags")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM attachments")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notes_text")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notes")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM tags")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notebooks")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM note_files")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ocr_text")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ocr_files")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM sqlite_sequence WHERE name IN ('note_tags','attachments','notes_text','notes','tags','notebooks','note_files','ocr_files','ocr_text')")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let mut stack_name_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut stack_order: Vec<String> = Vec::new();
    let mut stack_seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for stack in &stacks {
        if let Some(raw_id) = stack.get("id").and_then(|v| v.as_str()) {
            if let Some(stack_key) = normalize_stack_id(Some(raw_id)) {
                if stack_seen.insert(stack_key.clone()) {
                    stack_order.push(stack_key.clone());
                    let name = stack
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(raw_id)
                        .to_string();
                    stack_name_map.insert(stack_key, name);
                }
            }
        }
    }

    let mut unsorted_needed = false;
    for nb in &notebooks {
        let stack_raw = nb
            .get("personal_Stack_id")
            .and_then(|v| v.as_str())
            .or_else(|| nb.get("stack_Stack_id").and_then(|v| v.as_str()));
        if let Some(stack_key) = normalize_stack_id(stack_raw) {
            if stack_seen.insert(stack_key.clone()) {
                stack_order.push(stack_key.clone());
                stack_name_map
                    .entry(stack_key.clone())
                    .or_insert(stack_key.clone());
            }
        } else {
            unsorted_needed = true;
        }
    }

    let mut stack_id_map = std::collections::HashMap::new();
    let mut stack_index = 0i64;
    for stack_key in &stack_order {
        let name = stack_name_map
            .get(stack_key)
            .cloned()
            .unwrap_or_else(|| stack_key.clone());
        sqlx::query(
            "INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order, external_id)
             VALUES (?, ?, NULL, 'stack', ?, ?)",
        )
        .bind(name)
        .bind(now)
        .bind(stack_index)
        .bind(format!("stack:{}", stack_key))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        stack_id_map.insert(stack_key.clone(), row_id.0);
        stack_index += 1;
    }

    if unsorted_needed && !stack_id_map.contains_key("__unsorted__") {
        sqlx::query(
            "INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order, external_id)
             VALUES ('Unsorted', ?, NULL, 'stack', ?, ?)",
        )
        .bind(now)
        .bind(stack_index)
        .bind("stack:__unsorted__")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        stack_id_map.insert("__unsorted__".to_string(), row_id.0);
    }

    let mut notebook_id_map = std::collections::HashMap::new();
    let mut notebook_order: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    for nb in &notebooks {
        let stack_raw = nb
            .get("personal_Stack_id")
            .and_then(|v| v.as_str())
            .or_else(|| nb.get("stack_Stack_id").and_then(|v| v.as_str()));
        let stack_id = normalize_stack_id(stack_raw).unwrap_or_else(|| "__unsorted__".to_string());
        let parent_id = stack_id_map.get(&stack_id).copied();
        let index = notebook_order.get(&stack_id).copied().unwrap_or(0);
        let name = nb
            .get("label")
            .and_then(|v| v.as_str())
            .or_else(|| nb.get("name").and_then(|v| v.as_str()))
            .or_else(|| nb.get("title").and_then(|v| v.as_str()))
            .map(|value| value.to_string())
            .or_else(|| nb.get("id").and_then(value_to_string))
            .unwrap_or_else(|| "Notebook".to_string());
        let external_id = nb.get("id").and_then(value_to_string).unwrap_or_default();
        sqlx::query(
            "INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order, external_id)
             VALUES (?, ?, ?, 'notebook', ?, ?)",
        )
        .bind(name)
        .bind(now)
        .bind(parent_id)
        .bind(index)
        .bind(external_id.clone())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        notebook_id_map.insert(external_id, row_id.0);
        notebook_order.insert(stack_id, index + 1);
    }

    let mut note_id_map = std::collections::HashMap::new();
    for note in &notes {
        let title = note
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let content = note
            .get("contentNormalized")
            .and_then(|v| v.as_str())
            .or_else(|| note.get("content").and_then(|v| v.as_str()))
            .unwrap_or("");
        let created_at = note
            .get("createdAt")
            .and_then(|v| v.as_i64())
            .unwrap_or(now);
        let updated_at = note
            .get("updatedAt")
            .and_then(|v| v.as_i64())
            .unwrap_or(created_at);
        let notebook_external = note
            .get("notebookId")
            .and_then(value_to_string)
            .or_else(|| {
                note.get("noteFields")
                    .and_then(|v| v.get("parent_Notebook_id"))
                    .and_then(value_to_string)
            });
        let notebook_id = notebook_external
            .as_ref()
            .and_then(|id| notebook_id_map.get(id))
            .copied();
        let content_hash = note
            .get("contentHash")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let content_size = note.get("contentSize").and_then(|v| v.as_i64());
        let meta = note.get("meta").map(|v| v.to_string());
        let external_id = note.get("id").and_then(value_to_string).unwrap_or_default();
        sqlx::query(
            "INSERT INTO notes (title, content, created_at, updated_at, notebook_id, external_id, meta, content_hash, content_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&title)
        .bind(content)
        .bind(created_at)
        .bind(updated_at)
        .bind(notebook_id)
        .bind(external_id.clone())
        .bind(meta)
        .bind(content_hash)
        .bind(content_size)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        note_id_map.insert(external_id, row_id.0);
        let plain = strip_html(content);
        sqlx::query(
            "INSERT INTO notes_text (note_id, title, plain_text)
             VALUES (?, ?, ?)",
        )
        .bind(row_id.0)
        .bind(&title)
        .bind(plain)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    let mut tag_id_map = std::collections::HashMap::new();
    let roots: Vec<&Value> = tags
        .iter()
        .filter(|tag| {
            let parent_a = tag.get("parentId").and_then(|v| v.as_i64());
            let parent_b = tag.get("parent_Tag_id").and_then(|v| v.as_i64());
            parent_a.is_none() && parent_b.is_none()
        })
        .collect();
    for tag in roots {
        let name = tag
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| tag.get("label").and_then(|v| v.as_str()))
            .map(|value| value.to_string())
            .or_else(|| tag.get("id").and_then(value_to_string))
            .unwrap_or_else(|| "Tag".to_string());
        let external_id = tag.get("id").and_then(value_to_string).unwrap_or_default();
        sqlx::query(
            "INSERT INTO tags (name, parent_id, created_at, updated_at, external_id)
             VALUES (?, NULL, ?, ?, ?)",
        )
        .bind(&name)
        .bind(now)
        .bind(now)
        .bind(external_id.clone())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        tag_id_map.insert(external_id, row_id.0);
    }

    let children: Vec<&Value> = tags
        .iter()
        .filter(|tag| {
            let parent_a = tag.get("parentId").and_then(|v| v.as_i64());
            let parent_b = tag.get("parent_Tag_id").and_then(|v| v.as_i64());
            parent_a.is_some() || parent_b.is_some()
        })
        .collect();
    for tag in children {
        let parent_key = tag
            .get("parentId")
            .and_then(value_to_string)
            .or_else(|| tag.get("parent_Tag_id").and_then(value_to_string));
        let parent_id = parent_key
            .as_ref()
            .and_then(|id| tag_id_map.get(id))
            .copied();
        let name = tag
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| tag.get("label").and_then(|v| v.as_str()))
            .map(|value| value.to_string())
            .or_else(|| tag.get("id").and_then(value_to_string))
            .unwrap_or_else(|| "Tag".to_string());
        let external_id = tag.get("id").and_then(value_to_string).unwrap_or_default();
        sqlx::query(
            "INSERT INTO tags (name, parent_id, created_at, updated_at, external_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&name)
        .bind(parent_id)
        .bind(now)
        .bind(now)
        .bind(external_id.clone())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        tag_id_map.insert(external_id, row_id.0);
    }

    for nt in &note_tags {
        let note_external = nt
            .get("note_id")
            .or_else(|| nt.get("noteId"))
            .or_else(|| nt.get("Note_id"))
            .and_then(value_to_string);
        let tag_external = nt
            .get("tag_id")
            .or_else(|| nt.get("tagId"))
            .or_else(|| nt.get("Tag_id"))
            .and_then(value_to_string);
        let note_id = note_external
            .as_ref()
            .and_then(|id| note_id_map.get(id))
            .copied();
        let tag_id = tag_external
            .as_ref()
            .and_then(|id| tag_id_map.get(id))
            .copied();
        if let (Some(note_id), Some(tag_id)) = (note_id, tag_id) {
            sqlx::query("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)")
                .bind(note_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    for attachment in &attachments {
        let fields = attachment.get("attachmentFields").unwrap_or(attachment);
        let note_external = attachment
            .get("noteId")
            .or_else(|| fields.get("parent_Note_id"))
            .and_then(value_to_string);
        let note_id = note_external
            .as_ref()
            .and_then(|id| note_id_map.get(id))
            .copied();
        if note_id.is_none() {
            continue;
        }
        let hash = attachment
            .get("dataHash")
            .or_else(|| fields.get("dataHash"))
            .and_then(value_to_string);
        let filename = attachment
            .get("filename")
            .or_else(|| fields.get("filename"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let mime = attachment
            .get("mime")
            .or_else(|| fields.get("mime"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let size = attachment
            .get("dataSize")
            .or_else(|| fields.get("dataSize"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let width = fields
            .get("width")
            .or_else(|| fields.get("imageWidth"))
            .and_then(|v| v.as_i64());
        let height = fields
            .get("height")
            .or_else(|| fields.get("imageHeight"))
            .and_then(|v| v.as_i64());
        let rel_path = attachment
            .get("localFile")
            .and_then(|v| v.get("relPath"))
            .and_then(|v| v.as_str())
            .map(|rel| format!("files/{}", rel));
        let source_url = fields
            .get("sourceUrl")
            .or_else(|| fields.get("sourceURL"))
            .or_else(|| fields.get("source_url"))
            .and_then(|v| v.as_str());
        let explicit_attachment = fields
            .get("isAttachment")
            .and_then(|v| v.as_i64())
            .or_else(|| fields.get("is_attachment").and_then(|v| v.as_i64()));
        let mime_lc = mime.as_ref().map(|m| m.to_lowercase());
        let is_attachment = explicit_attachment
            .map(|value| value != 0)
            .unwrap_or_else(|| mime_lc.is_some_and(|lower| !lower.starts_with("image/")));
        let is_attachment_value = if is_attachment { 1 } else { 0 };
        let created_at = fields
            .get("created")
            .or_else(|| fields.get("createdAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(now);
        let updated_at = fields
            .get("updated")
            .or_else(|| fields.get("updatedAt"))
            .and_then(|v| v.as_i64())
            .unwrap_or(created_at);

        if rel_path.is_none() {
            continue;
        }

        sqlx::query(
            "INSERT INTO attachments (note_id, external_id, hash, filename, mime, size, width, height, local_path, source_url, is_attachment, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(note_id)
        .bind(fields.get("id").and_then(value_to_string))
        .bind(hash)
        .bind(filename)
        .bind(mime)
        .bind(size)
        .bind(width)
        .bind(height)
        .bind(rel_path.unwrap_or_default())
        .bind(source_url)
        .bind(is_attachment_value)
        .bind(created_at)
        .bind(updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    let files_dir = state.data_dir.join("files");
    if files_dir.exists() {
        let _ = fs::remove_dir_all(&files_dir);
    }
    if !assets_dir.trim().is_empty() {
        let assets_path = PathBuf::from(assets_dir);
        if assets_path.exists() {
            copy_dir_recursive(&assets_path, &files_dir)?;
        }
    }
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let _ = repo.backfill_note_files_and_ocr(&state.data_dir).await;
    Ok(EvernoteImportResult {
        notes: note_id_map.len() as i64,
        notebooks: notebook_id_map.len() as i64,
        tags: tag_id_map.len() as i64,
        attachments: attachments.len() as i64,
    })
}
