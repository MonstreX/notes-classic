use crate::services::prelude::*;
use crate::services::*;

#[tauri::command]
pub async fn select_notes_classic_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .set_title("Select Notes Classic export folder")
        .pick_folder(move |folder| {
            let path = folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}
#[derive(serde::Serialize)]
pub struct NotesClassicImportResult {
    notes: i64,
    notebooks: i64,
    tags: i64,
    attachments: i64,
    images: i64,
    errors: Vec<String>,
}
#[derive(serde::Serialize, Clone)]
pub struct NotesClassicImportProgress {
    stage: String,
    current: i64,
    total: i64,
    state: String,
    message: Option<String>,
}
#[tauri::command]
pub async fn import_notes_classic_from_manifest(
    manifest_path: String,
    backup_dir: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<NotesClassicImportResult, String> {
    let manifest_path = PathBuf::from(manifest_path.trim());
    if manifest_path.as_os_str().is_empty() {
        return Err("Manifest path is empty".to_string());
    }
    if !manifest_path.exists() {
        return Err("Manifest file not found".to_string());
    }
    let export_root = manifest_path
        .parent()
        .ok_or_else(|| "Export root not found".to_string())?
        .to_path_buf();

    let total_bytes = fs::metadata(&manifest_path)
        .map(|meta| meta.len() as i64)
        .unwrap_or(0);
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "package".to_string(),
            current: 0,
            total: total_bytes,
            state: "running".to_string(),
            message: None,
        },
    );
    let mut file = fs::File::open(&manifest_path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = vec![0u8; 65536];
    let mut read_bytes = 0i64;
    loop {
        let size = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..size]);
        read_bytes += size as i64;
        let _ = app_handle.emit(
            "import-notes-classic-progress",
            NotesClassicImportProgress {
                stage: "package".to_string(),
                current: read_bytes,
                total: total_bytes,
                state: "running".to_string(),
                message: None,
            },
        );
    }
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "package".to_string(),
            current: total_bytes,
            total: total_bytes,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.parse_manifest".to_string()),
        },
    );
    let manifest: ExportManifest = serde_json::from_slice(&buffer).map_err(|e| e.to_string())?;

    let total_notes = manifest.notes.len() as i64;
    let total_attachments = manifest.attachments.len() as i64 + manifest.ocr_files.len() as i64;
    let total_database_steps = 4;
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "notes".to_string(),
            current: 0,
            total: total_notes,
            state: "running".to_string(),
            message: None,
        },
    );
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "attachments".to_string(),
            current: 0,
            total: total_attachments,
            state: "running".to_string(),
            message: None,
        },
    );
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: 0,
            total: total_database_steps,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.preparing".to_string()),
        },
    );

    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: 1,
            total: total_database_steps,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.read_manifest".to_string()),
        },
    );

    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "package".to_string(),
            current: total_bytes,
            total: total_bytes,
            state: "done".to_string(),
            message: None,
        },
    );

    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: 2,
            total: total_database_steps,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.clear_storage".to_string()),
        },
    );
    clear_storage_for_import(state.clone()).await?;

    let data_dir = state.data_dir.clone();
    let files_dir = data_dir.join("files");
    fs::create_dir_all(&files_dir).map_err(|e| e.to_string())?;
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: 3,
            total: total_database_steps,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.prepare_files".to_string()),
        },
    );

    let pool = state.pool.clone();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut errors: Vec<String> = Vec::new();
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: 4,
            total: total_database_steps,
            state: "running".to_string(),
            message: Some("import_notes_classic.step.importing_content".to_string()),
        },
    );

    for nb in &manifest.notebooks {
        if let Err(e) = sqlx::query(
            "INSERT INTO notebooks (id, name, created_at, parent_id, notebook_type, sort_order, external_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(nb.id)
        .bind(&nb.name)
        .bind(nb.created_at)
        .bind(nb.parent_id)
        .bind(&nb.notebook_type)
        .bind(nb.sort_order)
        .bind(&nb.external_id)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("notebook {}: {}", nb.id, e));
        }
    }

    let mut notes_done = 0i64;
    for note in &manifest.notes {
        let content_path = export_root.join(&note.content_path);
        let content = fs::read_to_string(&content_path).unwrap_or_else(|e| {
            errors.push(format!("note {} html: {}", note.id, e));
            String::new()
        });
        let content = normalize_export_html(&content);
        if let Err(e) = sqlx::query(
            "INSERT INTO notes (id, title, content, created_at, updated_at, sync_status, remote_id, notebook_id, external_id, meta, content_hash, content_size, deleted_at, deleted_from_notebook_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(note.id)
        .bind(&note.title)
        .bind(&content)
        .bind(note.created_at)
        .bind(note.updated_at)
        .bind(note.sync_status)
        .bind(&note.remote_id)
        .bind(note.notebook_id)
        .bind(&note.external_id)
        .bind(&note.meta)
        .bind(&note.content_hash)
        .bind(note.content_size)
        .bind(note.deleted_at)
        .bind(note.deleted_from_notebook_id)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("note {}: {}", note.id, e));
        }
        let plain = strip_html(&content);
        if let Err(e) = sqlx::query(
            "INSERT INTO notes_text (note_id, title, plain_text)
             VALUES (?, ?, ?)",
        )
        .bind(note.id)
        .bind(&note.title)
        .bind(plain)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("notes_text {}: {}", note.id, e));
        }
        notes_done += 1;
        let _ = app_handle.emit(
            "import-notes-classic-progress",
            NotesClassicImportProgress {
                stage: "notes".to_string(),
                current: notes_done,
                total: total_notes,
                state: "running".to_string(),
                message: None,
            },
        );
    }

    for tag in &manifest.tags {
        if let Err(e) = sqlx::query(
            "INSERT INTO tags (id, name, parent_id, created_at, updated_at, external_id)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(tag.id)
        .bind(&tag.name)
        .bind(tag.parent_id)
        .bind(tag.created_at)
        .bind(tag.updated_at)
        .bind(&tag.external_id)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("tag {}: {}", tag.id, e));
        }
    }

    for link in &manifest.note_tags {
        if let Err(e) = sqlx::query(
            "INSERT INTO note_tags (note_id, tag_id)
             VALUES (?, ?)",
        )
        .bind(link.note_id)
        .bind(link.tag_id)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("note_tag {}-{}: {}", link.note_id, link.tag_id, e));
        }
    }

    let mut attachments_done = 0i64;
    for att in &manifest.attachments {
        let export_path = att.export_path.as_ref().map(|p| p.replace('\\', "/"));
        if export_path.is_none() {
            attachments_done += 1;
            let _ = app_handle.emit(
                "import-notes-classic-progress",
                NotesClassicImportProgress {
                    stage: "attachments".to_string(),
                    current: attachments_done,
                    total: total_attachments,
                    state: "running".to_string(),
                    message: None,
                },
            );
            continue;
        }
        let storage_path = export_path
            .as_ref()
            .map(|path| attachment_export_to_storage_path(path));
        if let (Some(ref exp), Some(ref dest)) = (export_path.as_ref(), storage_path.as_ref()) {
            let source = export_root.join(exp);
            let target = data_dir.join(dest);
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Err(e) = fs::copy(&source, &target) {
                errors.push(format!("attachment {} copy: {}", att.id, e));
            }
        }
        if let Err(e) = sqlx::query(
            "INSERT INTO attachments (id, note_id, external_id, hash, filename, mime, size, width, height, local_path, source_url, is_attachment, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(att.id)
        .bind(att.note_id)
        .bind(&att.external_id)
        .bind(&att.hash)
        .bind(&att.filename)
        .bind(&att.mime)
        .bind(att.size)
        .bind(att.width)
        .bind(att.height)
        .bind(storage_path)
        .bind(&att.source_url)
        .bind(att.is_attachment)
        .bind(att.created_at)
        .bind(att.updated_at)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("attachment {}: {}", att.id, e));
        }
        attachments_done += 1;
        let _ = app_handle.emit(
            "import-notes-classic-progress",
            NotesClassicImportProgress {
                stage: "attachments".to_string(),
                current: attachments_done,
                total: total_attachments,
                state: "running".to_string(),
                message: None,
            },
        );
    }

    for file in &manifest.ocr_files {
        let export_path = file.export_path.replace('\\', "/");
        let source = export_root.join(&export_path);
        let target = data_dir.join("files").join(&file.file_path);
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::copy(&source, &target) {
            errors.push(format!("ocr_file {} copy: {}", file.id, e));
        }
        if let Err(e) = sqlx::query(
            "INSERT INTO ocr_files (id, file_path, attempts_left, last_error)
             VALUES (?, ?, ?, ?)",
        )
        .bind(file.id)
        .bind(&file.file_path)
        .bind(file.attempts_left)
        .bind(&file.last_error)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("ocr_file {}: {}", file.id, e));
        }
        attachments_done += 1;
        let _ = app_handle.emit(
            "import-notes-classic-progress",
            NotesClassicImportProgress {
                stage: "attachments".to_string(),
                current: attachments_done,
                total: total_attachments,
                state: "running".to_string(),
                message: None,
            },
        );
    }

    for link in &manifest.note_files {
        if let Err(e) = sqlx::query(
            "INSERT INTO note_files (note_id, file_id)
             VALUES (?, ?)",
        )
        .bind(link.note_id)
        .bind(link.file_id)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!(
                "note_file {}-{}: {}",
                link.note_id, link.file_id, e
            ));
        }
    }

    for text in &manifest.ocr_text {
        if let Err(e) = sqlx::query(
            "INSERT INTO ocr_text (file_id, lang, text, hash, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(text.file_id)
        .bind(&text.lang)
        .bind(&text.text)
        .bind(&text.hash)
        .bind(text.updated_at)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("ocr_text {}: {}", text.file_id, e));
        }
    }

    for item in &manifest.note_history {
        if let Err(e) = sqlx::query(
            "INSERT INTO note_history (id, note_id, opened_at, note_title, notebook_id, notebook_name, stack_id, stack_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(item.id)
        .bind(item.note_id)
        .bind(item.opened_at)
        .bind(&item.note_title)
        .bind(item.notebook_id)
        .bind(&item.notebook_name)
        .bind(item.stack_id)
        .bind(&item.stack_name)
        .execute(&mut *tx)
        .await
        {
            errors.push(format!("history {}: {}", item.id, e));
        }
    }

    update_sqlite_sequence(&mut tx, "notebooks").await?;
    update_sqlite_sequence(&mut tx, "notes").await?;
    update_sqlite_sequence(&mut tx, "tags").await?;
    update_sqlite_sequence(&mut tx, "attachments").await?;
    update_sqlite_sequence(&mut tx, "ocr_files").await?;
    update_sqlite_sequence(&mut tx, "note_history").await?;

    tx.commit().await.map_err(|e| e.to_string())?;

    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "notes".to_string(),
            current: total_notes,
            total: total_notes,
            state: "done".to_string(),
            message: None,
        },
    );
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "attachments".to_string(),
            current: total_attachments,
            total: total_attachments,
            state: "done".to_string(),
            message: None,
        },
    );
    let _ = app_handle.emit(
        "import-notes-classic-progress",
        NotesClassicImportProgress {
            stage: "database".to_string(),
            current: total_database_steps,
            total: total_database_steps,
            state: "done".to_string(),
            message: None,
        },
    );

    let report_path = PathBuf::from(backup_dir).join("import_report.json");
    let report = NotesClassicImportResult {
        notes: manifest.notes.len() as i64,
        notebooks: manifest.notebooks.len() as i64,
        tags: manifest.tags.len() as i64,
        attachments: manifest.attachments.len() as i64,
        images: manifest.ocr_files.len() as i64,
        errors,
    };
    let json = serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?;
    fs::write(&report_path, json).map_err(|e| e.to_string())?;

    Ok(report)
}
