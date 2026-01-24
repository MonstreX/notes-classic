use crate::services::prelude::*;
use crate::services::*;

#[tauri::command]
pub async fn clear_storage_for_import(state: State<'_, AppState>) -> Result<(), String> {
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
    sqlx::query("DELETE FROM note_history")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM sqlite_sequence WHERE name IN ('note_tags','attachments','notes_text','notes','tags','notebooks','note_files','ocr_files','ocr_text','note_history')")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let files_dir = state.data_dir.join("files");
    if files_dir.exists() {
        let _ = fs::remove_dir_all(&files_dir);
    }
    let ocr_dir = state.data_dir.join("ocr");
    if ocr_dir.exists() {
        let _ = fs::remove_dir_all(&ocr_dir);
    }
    Ok(())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn import_attachment(
    noteId: i64,
    sourcePath: String,
    state: State<'_, AppState>,
) -> Result<Attachment, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let source = PathBuf::from(&sourcePath);
    let filename = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();
    let meta = fs::metadata(&source).map_err(|e| e.to_string())?;
    let size = meta.len() as i64;
    let mime = mime_guess::from_path(&source)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    let id = repo
        .create_attachment(noteId, &filename, &mime, size)
        .await
        .map_err(|e| e.to_string())?;
    let rel_dir = PathBuf::from("files")
        .join("attachments")
        .join(id.to_string());
    let dest_dir = state.data_dir.join(&rel_dir);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest_path = dest_dir.join(&filename);
    if let Err(e) = fs::copy(&source, &dest_path) {
        let _ = repo.delete_attachment(id).await;
        return Err(e.to_string());
    }
    let rel_path = rel_dir.join(&filename).to_string_lossy().replace('\\', "/");
    repo.update_attachment_path(id, &rel_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Attachment {
        id,
        note_id: noteId,
        filename,
        mime,
        size,
        local_path: rel_path,
    })
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn import_attachment_bytes(
    noteId: i64,
    filename: String,
    mime: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<Attachment, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let size = bytes.len() as i64;
    let resolved_mime = if mime.is_empty() {
        mime_guess::from_path(&filename)
            .first_or_octet_stream()
            .essence_str()
            .to_string()
    } else {
        mime
    };
    let id = repo
        .create_attachment(noteId, &filename, &resolved_mime, size)
        .await
        .map_err(|e| e.to_string())?;
    let rel_dir = PathBuf::from("files")
        .join("attachments")
        .join(id.to_string());
    let dest_dir = state.data_dir.join(&rel_dir);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest_path = dest_dir.join(&filename);
    if let Err(e) = fs::write(&dest_path, &bytes) {
        let _ = repo.delete_attachment(id).await;
        return Err(e.to_string());
    }
    let rel_path = rel_dir.join(&filename).to_string_lossy().replace('\\', "/");
    repo.update_attachment_path(id, &rel_path)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Attachment {
        id,
        note_id: noteId,
        filename,
        mime: resolved_mime,
        size,
        local_path: rel_path,
    })
}
#[tauri::command]
pub fn create_import_backup(kind: String, state: State<'_, AppState>) -> Result<String, String> {
    let clean = kind
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .to_lowercase();
    let prefix = if clean.is_empty() {
        "import"
    } else {
        clean.as_str()
    };
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = state
        .data_dir
        .join("backups")
        .join(format!("{}-{}", prefix, timestamp));
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let notes_db = state.data_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, backup_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&state.data_dir.join("files"), &backup_dir.join("files"))?;
    copy_dir_recursive(&state.data_dir.join("ocr"), &backup_dir.join("ocr"))?;
    Ok(backup_dir.to_string_lossy().to_string())
}
#[tauri::command]
pub fn restore_import_backup(backup_dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let backup = PathBuf::from(backup_dir.trim());
    if backup.as_os_str().is_empty() {
        return Err("Backup path is empty".to_string());
    }
    if !backup.exists() {
        return Err("Backup path not found".to_string());
    }
    remove_storage_data(&state.data_dir)?;
    let notes_db = backup.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, state.data_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&backup.join("files"), &state.data_dir.join("files"))?;
    copy_dir_recursive(&backup.join("ocr"), &state.data_dir.join("ocr"))?;
    Ok(())
}
