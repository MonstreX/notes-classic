use super::*;
use crate::services::prelude::*;

pub const SETTINGS_FILE_NAME: &str = "app.json";
pub const MAX_NOTE_FILE_BYTES: usize = 25 * 1024 * 1024;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    has_data: bool,
    notes_count: i64,
    notebooks_count: i64,
    last_note_at: Option<i64>,
    last_note_title: Option<String>,
    valid: bool,
}
#[derive(serde::Serialize)]
pub struct StoredNoteFile {
    pub rel_path: String,
    pub hash: String,
    pub mime: String,
}
pub fn ensure_dir_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let test_path = dir.join(".write_test");
    fs::write(&test_path, b"test").map_err(|e| e.to_string())?;
    fs::remove_file(&test_path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn read_settings_file(settings_dir: &Path) -> Result<Value, String> {
    let settings_path = settings_dir.join(SETTINGS_FILE_NAME);
    if !settings_path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
pub fn read_storage_override(settings_dir: &Path) -> Result<Option<PathBuf>, String> {
    let value = read_settings_file(settings_dir)?;
    let Some(obj) = value.as_object() else {
        return Ok(None);
    };
    let Some(dir_value) = obj.get("dataDir") else {
        return Ok(None);
    };
    let Some(path_str) = dir_value.as_str() else {
        return Ok(None);
    };
    if path_str.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(path_str)))
}
#[tauri::command]
pub fn get_storage_override(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let override_dir = read_storage_override(&state.settings_dir)?;
    Ok(override_dir.map(|dir| dir.to_string_lossy().to_string()))
}
pub fn default_data_dir(settings_dir: &Path) -> PathBuf {
    settings_dir
        .parent()
        .map(|dir| dir.join("data"))
        .unwrap_or_else(|| settings_dir.join("data"))
}
#[tauri::command]
pub fn get_default_storage_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(default_data_dir(&state.settings_dir)
        .to_string_lossy()
        .to_string())
}
pub fn remove_storage_data(target: &Path) -> Result<(), String> {
    let db = target.join("notes.db");
    if db.exists() {
        fs::remove_file(&db).map_err(|e| e.to_string())?;
    }
    let files_dir = target.join("files");
    if files_dir.exists() {
        fs::remove_dir_all(&files_dir).map_err(|e| e.to_string())?;
    }
    let ocr_dir = target.join("ocr");
    if ocr_dir.exists() {
        fs::remove_dir_all(&ocr_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn get_storage_info(path: String) -> Result<StorageInfo, String> {
    let target = PathBuf::from(path.trim());
    if target.as_os_str().is_empty() {
        return Err("Storage path is empty".to_string());
    }
    let db_path = target.join("notes.db");
    let has_data = db_path.exists() || target.join("files").exists();
    if !db_path.exists() {
        return Ok(StorageInfo {
            has_data,
            notes_count: 0,
            notebooks_count: 0,
            last_note_at: None,
            last_note_title: None,
            valid: true,
        });
    }
    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())?;
    let notes_count_result: Result<i64, _> =
        sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
            .fetch_one(&pool)
            .await;
    let notebooks_count_result: Result<i64, _> =
        sqlx::query_scalar("SELECT COUNT(*) FROM notebooks WHERE notebook_type = 'notebook'")
            .fetch_one(&pool)
            .await;
    let last_note_at_result: Result<Option<i64>, _> =
        sqlx::query_scalar("SELECT MAX(updated_at) FROM notes WHERE deleted_at IS NULL")
            .fetch_one(&pool)
            .await;
    let last_note_title_result: Result<Option<String>, _> = sqlx::query_scalar(
        "SELECT title FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
    )
    .fetch_optional(&pool)
    .await;
    let valid = notes_count_result.is_ok()
        && notebooks_count_result.is_ok()
        && last_note_at_result.is_ok()
        && last_note_title_result.is_ok();
    let notes_count = notes_count_result.unwrap_or(0);
    let notebooks_count = notebooks_count_result.unwrap_or(0);
    let last_note_at = last_note_at_result.unwrap_or(None);
    let last_note_title = last_note_title_result.unwrap_or(None);
    Ok(StorageInfo {
        has_data,
        notes_count,
        notebooks_count,
        last_note_at,
        last_note_title,
        valid,
    })
}
#[tauri::command]
pub fn set_storage_default(state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = default_data_dir(&state.settings_dir);
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;

    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.remove("dataDir");
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn set_storage_default_existing(state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = default_data_dir(&state.settings_dir);
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.remove("dataDir");
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn set_storage_default_replace(state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = default_data_dir(&state.settings_dir);
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    remove_storage_data(&new_dir)?;
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;

    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.remove("dataDir");
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn set_storage_path_existing(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("Storage path is empty".to_string());
    }
    let db_path = new_dir.join("notes.db");
    if !db_path.exists() {
        return Err("Storage database not found".to_string());
    }
    ensure_dir_writable(&new_dir)?;
    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.insert(
            "dataDir".to_string(),
            Value::String(new_dir.to_string_lossy().to_string()),
        );
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn set_storage_path_replace(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("Storage path is empty".to_string());
    }
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    remove_storage_data(&new_dir)?;
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;

    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.insert(
            "dataDir".to_string(),
            Value::String(new_dir.to_string_lossy().to_string()),
        );
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn set_storage_path_empty(
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("Storage path is empty".to_string());
    }
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let _ = crate::db::init_db(&new_dir)
        .await
        .map_err(|e| e.to_string())?;
    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.insert(
            "dataDir".to_string(),
            Value::String(new_dir.to_string_lossy().to_string()),
        );
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn set_storage_default_empty(state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = default_data_dir(&state.settings_dir);
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let _ = crate::db::init_db(&new_dir)
        .await
        .map_err(|e| e.to_string())?;
    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.remove("dataDir");
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    if !settings_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(value))
}
#[tauri::command]
pub fn set_settings(settings: Value, state: State<'_, AppState>) -> Result<(), String> {
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let (Some(base), Some(updates)) = (merged.as_object_mut(), settings.as_object()) {
        for (key, value) in updates {
            base.insert(key.clone(), value.clone());
        }
    }
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn set_storage_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("Storage path is empty".to_string());
    }
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;

    let mut merged = read_settings_file(&state.settings_dir)?;
    if !merged.is_object() {
        merged = Value::Object(serde_json::Map::new());
    }
    if let Some(base) = merged.as_object_mut() {
        base.insert(
            "dataDir".to_string(),
            Value::String(new_dir.to_string_lossy().to_string()),
        );
    }
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    let data = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, data).map_err(|e| e.to_string())?;
    Ok(())
}
