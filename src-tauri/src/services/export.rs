use super::*;
use crate::services::prelude::*;

pub fn normalize_export_html(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    while let Some(pos) = html[cursor..].find("src=") {
        let idx = cursor + pos;
        out.push_str(&html[cursor..idx]);
        let after = &html[idx + 4..];
        let quote = after.chars().next();
        if quote != Some('"') && quote != Some('\'') {
            out.push_str("src=");
            cursor = idx + 4;
            continue;
        }
        let Some(q) = quote else {
            out.push_str("src=");
            cursor = idx + 4;
            continue;
        };
        let remainder = &after[1..];
        if let Some(end) = remainder.find(q) {
            let url = &remainder[..end];
            if let Some(rel) = extract_rel_from_asset_url(url) {
                out.push_str("src=");
                out.push(q);
                out.push_str("files/");
                out.push_str(&rel);
                out.push(q);
            } else if let Some(rel) = url.strip_prefix("notes-file://files/") {
                out.push_str("src=");
                out.push(q);
                out.push_str("files/");
                out.push_str(rel);
                out.push(q);
            } else {
                out.push_str("src=");
                out.push(q);
                out.push_str(url);
                out.push(q);
            }
            cursor = idx + 4 + 1 + end + 1;
        } else {
            out.push_str("src=");
            cursor = idx + 4;
        }
    }
    out.push_str(&html[cursor..]);
    out
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportNotebook {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub parent_id: Option<i64>,
    pub notebook_type: String,
    pub sort_order: i64,
    pub external_id: Option<String>,
}
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ExportNote {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sync_status: Option<i64>,
    pub remote_id: Option<String>,
    pub notebook_id: Option<i64>,
    pub external_id: Option<String>,
    pub meta: Option<String>,
    pub content_hash: Option<String>,
    pub content_size: Option<i64>,
    pub deleted_at: Option<i64>,
    pub deleted_from_notebook_id: Option<i64>,
    pub content_path: String,
    pub meta_path: String,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportNoteText {
    pub note_id: i64,
    pub title: String,
    pub plain_text: String,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportTag {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub external_id: Option<String>,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportNoteTag {
    pub note_id: i64,
    pub tag_id: i64,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportAttachment {
    pub id: i64,
    pub note_id: i64,
    pub external_id: Option<String>,
    pub hash: Option<String>,
    pub filename: Option<String>,
    pub mime: Option<String>,
    pub size: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub local_path: Option<String>,
    pub source_url: Option<String>,
    pub is_attachment: Option<i64>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub export_path: Option<String>,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportOcrFile {
    pub id: i64,
    pub file_path: String,
    pub attempts_left: i64,
    pub last_error: Option<String>,
    pub export_path: String,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportNoteFile {
    pub note_id: i64,
    pub file_id: i64,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportOcrText {
    pub file_id: i64,
    pub lang: String,
    pub text: String,
    pub hash: String,
    pub updated_at: i64,
}
#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct ExportHistory {
    pub id: i64,
    pub note_id: i64,
    pub opened_at: i64,
    pub note_title: String,
    pub notebook_id: Option<i64>,
    pub notebook_name: Option<String>,
    pub stack_id: Option<i64>,
    pub stack_name: Option<String>,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportManifest {
    pub version: String,
    pub exported_at: String,
    pub notebooks: Vec<ExportNotebook>,
    pub notes: Vec<ExportNote>,
    pub notes_text: Vec<ExportNoteText>,
    pub tags: Vec<ExportTag>,
    pub note_tags: Vec<ExportNoteTag>,
    pub attachments: Vec<ExportAttachment>,
    pub ocr_files: Vec<ExportOcrFile>,
    pub note_files: Vec<ExportNoteFile>,
    pub ocr_text: Vec<ExportOcrText>,
    pub note_history: Vec<ExportHistory>,
}
#[derive(serde::Serialize)]
pub struct ExportReport {
    pub export_root: String,
    pub manifest_path: String,
    pub notes: i64,
    pub notebooks: i64,
    pub tags: i64,
    pub attachments: i64,
    pub images: i64,
    pub errors: Vec<String>,
}
#[tauri::command]
pub async fn export_notes_classic(
    dest_dir: String,
    state: State<'_, AppState>,
) -> Result<ExportReport, String> {
    if dest_dir.trim().is_empty() {
        return Err("Export folder is empty".to_string());
    }
    let now = chrono::Utc::now();
    let stamp = now.format("%Y%m%d-%H%M%S").to_string();
    let export_root = PathBuf::from(dest_dir).join(format!("notes-classic-export-{}", stamp));
    fs::create_dir_all(&export_root).map_err(|e| e.to_string())?;
    let notes_dir = export_root.join("notes");
    let attachments_dir = export_root.join("attachments");
    let files_dir = export_root.join("files");
    fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&files_dir).map_err(|e| e.to_string())?;

    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let mut errors: Vec<String> = Vec::new();

    let notebooks: Vec<ExportNotebook> = sqlx::query_as(
        "SELECT id, name, created_at, parent_id, notebook_type, sort_order, external_id FROM notebooks ORDER BY id ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let notes_rows: Vec<(i64, String, String, i64, i64, Option<i64>, Option<String>, Option<i64>, Option<String>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, title, content, created_at, updated_at, sync_status, remote_id, notebook_id, external_id, meta, content_hash, content_size, deleted_at, deleted_from_notebook_id
             FROM notes ORDER BY id ASC",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let notes_text: Vec<ExportNoteText> =
        sqlx::query_as("SELECT note_id, title, plain_text FROM notes_text ORDER BY note_id ASC")
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

    let tags: Vec<ExportTag> = sqlx::query_as(
        "SELECT id, name, parent_id, created_at, updated_at, external_id FROM tags ORDER BY id ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let note_tags: Vec<ExportNoteTag> =
        sqlx::query_as("SELECT note_id, tag_id FROM note_tags ORDER BY note_id ASC, tag_id ASC")
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

    let attachments_rows: Vec<(i64, i64, Option<String>, Option<String>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<i64>, Option<String>, Option<String>, Option<i64>, Option<i64>, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, note_id, external_id, hash, filename, mime, size, width, height, local_path, source_url, is_attachment, created_at, updated_at
             FROM attachments ORDER BY id ASC",
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let ocr_files_rows: Vec<(i64, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT id, file_path, attempts_left, last_error FROM ocr_files ORDER BY id ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let note_files: Vec<ExportNoteFile> =
        sqlx::query_as("SELECT note_id, file_id FROM note_files ORDER BY note_id ASC, file_id ASC")
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

    let ocr_text: Vec<ExportOcrText> = sqlx::query_as(
        "SELECT file_id, lang, text, hash, updated_at FROM ocr_text ORDER BY file_id ASC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let note_history: Vec<ExportHistory> = sqlx::query_as(
        "SELECT id, note_id, opened_at, note_title, notebook_id, notebook_name, stack_id, stack_name
         FROM note_history ORDER BY opened_at DESC, id DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut notes: Vec<ExportNote> = Vec::new();
    for row in notes_rows {
        let (
            id,
            title,
            content,
            created_at,
            updated_at,
            sync_status,
            remote_id,
            notebook_id,
            external_id,
            meta,
            content_hash,
            content_size,
            deleted_at,
            deleted_from_notebook_id,
        ) = row;
        let content_path = format!("notes/{}.html", id);
        let meta_path = format!("notes/{}.meta.json", id);
        let note = ExportNote {
            id,
            title: title.clone(),
            created_at,
            updated_at,
            sync_status,
            remote_id,
            notebook_id,
            external_id,
            meta,
            content_hash,
            content_size,
            deleted_at,
            deleted_from_notebook_id,
            content_path: content_path.clone(),
            meta_path: meta_path.clone(),
        };
        let html_path = export_root.join(&content_path);
        let normalized = normalize_export_html(&content);
        if let Err(e) = fs::write(&html_path, normalized) {
            errors.push(format!("note {} html: {}", id, e));
        }
        let meta_json = serde_json::to_string_pretty(&note).map_err(|e| e.to_string())?;
        if let Err(e) = fs::write(export_root.join(&meta_path), meta_json) {
            errors.push(format!("note {} meta: {}", id, e));
        }
        notes.push(note);
    }

    let mut attachments: Vec<ExportAttachment> = Vec::new();
    for row in attachments_rows {
        let (
            id,
            note_id,
            external_id,
            hash,
            filename,
            mime,
            size,
            width,
            height,
            local_path,
            source_url,
            is_attachment,
            created_at,
            updated_at,
        ) = row;
        let mut export_path = local_path.as_ref().map(|path| {
            let cleaned = path
                .trim_start_matches("files/")
                .trim_start_matches("files\\")
                .replace('\\', "/");
            if cleaned.starts_with("attachments/") {
                cleaned
            } else {
                format!("attachments/{}", cleaned)
            }
        });
        if let Some(ref rel) = local_path {
            let source = data_dir.join(rel);
            if let Some(ref export_rel) = export_path {
                let target = export_root.join(export_rel);
                if let Some(parent) = target.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Err(e) = fs::copy(&source, &target) {
                    errors.push(format!("attachment {} copy: {}", id, e));
                    export_path = None;
                }
            }
        }
        attachments.push(ExportAttachment {
            id,
            note_id,
            external_id,
            hash,
            filename,
            mime,
            size,
            width,
            height,
            local_path,
            source_url,
            is_attachment,
            created_at,
            updated_at,
            export_path,
        });
    }

    let mut ocr_files: Vec<ExportOcrFile> = Vec::new();
    for (id, file_path, attempts_left, last_error) in ocr_files_rows {
        let export_path = format!("files/{}", file_path.replace('\\', "/"));
        let source = data_dir.join("files").join(&file_path);
        let target = export_root.join(&export_path);
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::copy(&source, &target) {
            errors.push(format!("file {} copy: {}", id, e));
        }
        ocr_files.push(ExportOcrFile {
            id,
            file_path,
            attempts_left,
            last_error,
            export_path,
        });
    }

    let manifest = ExportManifest {
        version: "1.0".to_string(),
        exported_at: now.to_rfc3339(),
        notebooks,
        notes: notes.clone(),
        notes_text,
        tags,
        note_tags,
        attachments,
        ocr_files,
        note_files,
        ocr_text,
        note_history,
    };

    let manifest_path = export_root.join("manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(&manifest_path, manifest_json).map_err(|e| e.to_string())?;

    Ok(ExportReport {
        export_root: export_root.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        notes: notes.len() as i64,
        notebooks: manifest.notebooks.len() as i64,
        tags: manifest.tags.len() as i64,
        attachments: manifest.attachments.len() as i64,
        images: manifest.ocr_files.len() as i64,
        errors,
    })
}
pub async fn update_sqlite_sequence(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<(), String> {
    let query = format!("SELECT MAX(id) FROM {}", table);
    let max_id: Option<i64> = sqlx::query_scalar(&query)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    let seq = max_id.unwrap_or(0);
    sqlx::query("DELETE FROM sqlite_sequence WHERE name = ?")
        .bind(table)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)")
        .bind(table)
        .bind(seq)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn attachment_export_to_storage_path(export_path: &str) -> String {
    let cleaned = export_path.replace('\\', "/");
    let rel = cleaned
        .trim_start_matches("attachments/")
        .trim_start_matches("files/")
        .trim_start_matches('/');
    format!("files/{}", rel)
}
