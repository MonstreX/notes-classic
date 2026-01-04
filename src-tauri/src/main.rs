#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{Attachment, Note, NoteCounts, NoteListItem, Notebook, OcrFileItem, OcrStats, SqliteRepository, Tag};
use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use http::{Request, Response, StatusCode, Uri};
use reqwest;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuItem, MenuItemKind, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

const NOTES_VIEW_DETAILED: &str = "view_notes_detailed";
const NOTES_VIEW_COMPACT: &str = "view_notes_compact";
const SETTINGS_FILE_NAME: &str = "app.json";
const FILE_IMPORT_EVERNOTE: &str = "file_import_evernote";
const MENU_NEW_NOTE: &str = "menu_new_note";
const MENU_NEW_NOTEBOOK: &str = "menu_new_notebook";
const MENU_NEW_STACK: &str = "menu_new_stack";
const MENU_DELETE_NOTE: &str = "menu_delete_note";
const MENU_SEARCH: &str = "menu_search";
const MENU_SETTINGS: &str = "menu_settings";
const MAX_NOTE_FILE_BYTES: usize = 25 * 1024 * 1024;
static NOTE_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct AppState {
    pool: sqlx::sqlite::SqlitePool,
    settings_dir: PathBuf,
    data_dir: PathBuf,
}

#[cfg(debug_assertions)]
#[tauri::command]
fn restart_app(app_handle: AppHandle) -> Result<(), String> {
    std::thread::sleep(std::time::Duration::from_secs(2));
    app_handle.restart();
}

#[cfg(not(debug_assertions))]
#[tauri::command]
fn restart_app(app_handle: AppHandle) -> Result<(), String> {
    std::thread::sleep(std::time::Duration::from_secs(2));
    if let Ok(exe) = std::env::current_exe() {
        if std::process::Command::new(exe).spawn().is_ok() {
            app_handle.exit(0);
            return Ok(());
        }
    }
    app_handle.restart();
}

#[tauri::command]
fn exit_app(app_handle: AppHandle) -> Result<(), String> {
    app_handle.exit(0);
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    has_data: bool,
    notes_count: i64,
    notebooks_count: i64,
    last_note_at: Option<i64>,
    last_note_title: Option<String>,
    valid: bool,
}

#[derive(serde::Serialize)]
struct StoredNoteFile {
    rel_path: String,
    hash: String,
    mime: String,
}

fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ => {
                if !in_tag {
                    output.push(ch);
                }
            }
        }
    }
    output
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_stack_id(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("Stack:") {
        return Some(raw.trim_start_matches("Stack:").to_string());
    }
    Some(raw.to_string())
}

fn value_to_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(num) = value.as_i64() {
        return Some(num.to_string());
    }
    if let Some(num) = value.as_u64() {
        return Some(num.to_string());
    }
    None
}

fn ext_from_filename(filename: &str) -> Option<String> {
    Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.trim().trim_start_matches('.').to_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn ext_from_mime(mime: &str) -> Option<String> {
    mime_guess::get_mime_extensions_str(mime)
        .and_then(|exts| exts.first().copied())
        .map(|ext| ext.to_string())
}

fn filename_from_url(url: &str) -> Option<String> {
    let trimmed = url.split('?').next().unwrap_or(url);
    trimmed.rsplit('/').next().map(|s| s.to_string()).filter(|s| !s.is_empty())
}

fn store_note_bytes(data_dir: &Path, filename: &str, mime: &str, bytes: &[u8]) -> Result<StoredNoteFile, String> {
    if bytes.is_empty() {
        return Err("Empty file bytes".to_string());
    }
    if bytes.len() > MAX_NOTE_FILE_BYTES {
        return Err("File exceeds maximum size".to_string());
    }
    let filename_ext = ext_from_filename(filename);
    let mime_ext = ext_from_mime(mime);
    let resolved_ext = if mime.starts_with("image/") {
        mime_ext.clone().or(filename_ext.clone())
    } else {
        filename_ext.clone().or(mime_ext.clone())
    }
    .unwrap_or_else(|| "bin".to_string());
    let resolved_mime = if !mime.is_empty() {
        mime.to_string()
    } else {
        mime_guess::from_ext(&resolved_ext)
            .first_or_octet_stream()
            .to_string()
    };

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let content_hash = format!("{:x}", hasher.finalize());
    let nonce = NOTE_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let mut name_hasher = Sha256::new();
    name_hasher.update(bytes);
    name_hasher.update(nanos.to_string().as_bytes());
    name_hasher.update(nonce.to_string().as_bytes());
    let unique_hash = format!("{:x}", name_hasher.finalize());
    let rel_dir = PathBuf::from("files").join(&unique_hash[0..2]);
    let rel_file = format!("{}.{}", unique_hash, resolved_ext);
    let rel_path = rel_dir.join(&rel_file);
    let full_dir = data_dir.join(&rel_dir);
    fs::create_dir_all(&full_dir).map_err(|e| e.to_string())?;
    let full_path = data_dir.join(&rel_path);
    fs::write(&full_path, bytes).map_err(|e| e.to_string())?;
    let rel_display = PathBuf::from(&unique_hash[0..2]).join(rel_file);
    Ok(StoredNoteFile {
        rel_path: rel_display.to_string_lossy().replace('\\', "/"),
        hash: content_hash,
        mime: resolved_mime,
    })
}

fn ensure_dir_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let test_path = dir.join(".write_test");
    fs::write(&test_path, b"test").map_err(|e| e.to_string())?;
    fs::remove_file(&test_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_settings_file(settings_dir: &Path) -> Result<Value, String> {
    let settings_path = settings_dir.join(SETTINGS_FILE_NAME);
    if !settings_path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn read_storage_override(settings_dir: &Path) -> Result<Option<PathBuf>, String> {
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
fn get_storage_override(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let override_dir = read_storage_override(&state.settings_dir)?;
    Ok(override_dir.map(|dir| dir.to_string_lossy().to_string()))
}

fn default_data_dir(settings_dir: &Path) -> PathBuf {
    settings_dir
        .parent()
        .map(|dir| dir.join("data"))
        .unwrap_or_else(|| settings_dir.join("data"))
}

#[tauri::command]
fn get_default_storage_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(default_data_dir(&state.settings_dir).to_string_lossy().to_string())
}

fn remove_storage_data(target: &Path) -> Result<(), String> {
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
async fn get_storage_info(path: String) -> Result<StorageInfo, String> {
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
    let last_note_title_result: Result<Option<String>, _> =
        sqlx::query_scalar("SELECT title FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1")
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
fn set_storage_default(state: State<'_, AppState>) -> Result<(), String> {
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
fn set_storage_default_existing(state: State<'_, AppState>) -> Result<(), String> {
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
fn set_storage_default_replace(state: State<'_, AppState>) -> Result<(), String> {
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
fn set_storage_path_existing(path: String, state: State<'_, AppState>) -> Result<(), String> {
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
fn set_storage_path_replace(path: String, state: State<'_, AppState>) -> Result<(), String> {
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
async fn set_storage_path_empty(path: String, state: State<'_, AppState>) -> Result<(), String> {
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
    let _ = db::init_db(&new_dir).await.map_err(|e| e.to_string())?;
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
async fn set_storage_default_empty(state: State<'_, AppState>) -> Result<(), String> {
    let new_dir = default_data_dir(&state.settings_dir);
    let current_dir = state.data_dir.clone();
    if current_dir == new_dir {
        return Ok(());
    }
    ensure_dir_writable(&new_dir)?;
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let _ = db::init_db(&new_dir).await.map_err(|e| e.to_string())?;
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

fn resolve_portable_paths() -> Result<(PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Failed to resolve executable directory".to_string())?;
    let mut data_dir = exe_dir.join("data");
    let mut settings_dir = exe_dir.join("settings");

    if let Ok(cwd) = std::env::current_dir() {
        let mut candidates = Vec::new();
        candidates.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
        if let Some(grand) = cwd.parent().and_then(|p| p.parent()) {
            candidates.push(grand.to_path_buf());
        }
        for base in candidates {
            let is_dev_root = base.join("package.json").exists() && base.join("src-tauri").exists();
            if is_dev_root {
                data_dir = base.join("data");
                settings_dir = base.join("settings");
                break;
            }
        }
    }
    ensure_dir_writable(&settings_dir)?;
    if let Ok(Some(override_dir)) = read_storage_override(&settings_dir) {
        data_dir = override_dir;
    }
    ensure_dir_writable(&data_dir)?;

    Ok((data_dir, settings_dir))
}

#[tauri::command]
fn get_resource_dir(app_handle: AppHandle) -> Result<String, String> {
    let resource_dir = app_handle.path().resource_dir().map_err(|e| e.to_string())?;
    let test_name = "eng.traineddata.gz";
    let has_tessdata = |dir: &PathBuf| dir.join("ocr").join("tessdata").join(test_name).exists();
    if has_tessdata(&resource_dir) {
        return Ok(resource_dir.to_string_lossy().to_string());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent().map(|p| p.to_path_buf()) {
            let candidate = exe_dir.join("resources");
            if has_tessdata(&candidate) {
                return Ok(candidate.to_string_lossy().to_string());
            }
            let mut current = Some(exe_dir);
            for _ in 0..6 {
                let Some(dir) = current.take() else { break };
                let candidate = dir.join("src-tauri").join("resources");
                if has_tessdata(&candidate) {
                    return Ok(candidate.to_string_lossy().to_string());
                }
                current = dir.parent().map(|p| p.to_path_buf());
            }
        }
    }
    Ok(resource_dir.to_string_lossy().to_string())
}

fn notes_file_response(data_dir: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri: &Uri = request.uri();
    let host = uri.host().unwrap_or_default();
    let mut rel = String::new();
    if !host.is_empty() {
        rel.push_str(host);
    }
    let path = uri.path().trim_start_matches('/');
    if !path.is_empty() {
        if !rel.is_empty() {
            rel.push('/');
        }
        rel.push_str(path);
    }
    if rel.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    let full_path = data_dir.join(rel);
    if !full_path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    let bytes = match fs::read(&full_path) {
        Ok(data) => data,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()))
        }
    };
    let mime = match full_path.extension().and_then(|ext| ext.to_str()).map(|s| s.to_lowercase()) {
        Some(ext) if ext == "png" => "image/png",
        Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
        Some(ext) if ext == "jfif" => "image/jpeg",
        Some(ext) if ext == "gif" => "image/gif",
        Some(ext) if ext == "webp" => "image/webp",
        Some(ext) if ext == "svg" => "image/svg+xml",
        Some(ext) if ext == "pdf" => "application/pdf",
        Some(ext) if ext == "txt" => "text/plain",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn find_check_menu_item<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<CheckMenuItem<R>> {
    for item in items {
        if item.id() == &id {
            if let Some(check) = item.as_check_menuitem() {
                return Some(check.clone());
            }
        }
        if let Some(submenu) = item.as_submenu() {
            if let Ok(children) = submenu.items() {
                if let Some(found) = find_check_menu_item(children, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn update_notes_list_menu(app_handle: &AppHandle, view: &str) {
    let Some(menu) = app_handle.menu() else {
        return;
    };
    if let Ok(items) = menu.items() {
        if let Some(item) = find_check_menu_item(items, NOTES_VIEW_DETAILED) {
            let _ = item.set_checked(view == "detailed");
        }
    }
    if let Ok(items) = menu.items() {
        if let Some(item) = find_check_menu_item(items, NOTES_VIEW_COMPACT) {
            let _ = item.set_checked(view == "compact");
        }
    }
}

fn load_i18n_messages(path: &Path) -> std::collections::HashMap<String, String> {
    let raw = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return std::collections::HashMap::new(),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(val) => val,
        Err(_) => return std::collections::HashMap::new(),
    };
    value
        .as_object()
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, val)| val.as_str().map(|v| (key.to_string(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_language(settings_dir: &Path) -> String {
    let value = read_settings_file(settings_dir).unwrap_or(Value::Null);
    let lang = value
        .as_object()
        .and_then(|obj| obj.get("language"))
        .and_then(|v| v.as_str())
        .unwrap_or("en")
        .to_string();
    if lang == "ru" { "ru".to_string() } else { "en".to_string() }
}

fn load_i18n_bundle(
    settings_dir: &Path,
    resource_dir: &Path,
) -> (std::collections::HashMap<String, String>, std::collections::HashMap<String, String>) {
    let fallback_path = resource_dir.join("i18n").join("en.json");
    let lang = resolve_language(settings_dir);
    let lang_path = resource_dir.join("i18n").join(format!("{}.json", lang));
    let fallback = load_i18n_messages(&fallback_path);
    let current = if lang == "en" {
        fallback.clone()
    } else {
        load_i18n_messages(&lang_path)
    };
    (current, fallback)
}

fn t(
    map: &std::collections::HashMap<String, String>,
    fallback: &std::collections::HashMap<String, String>,
    key: &str,
) -> String {
    if let Some(value) = map.get(key) {
        return value.to_string();
    }
    if let Some(value) = fallback.get(key) {
        return value.to_string();
    }
    key.to_string()
}

fn resolve_i18n_dir<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    let has_i18n = |dir: &PathBuf| dir.join("i18n").join("en.json").exists();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let dir = resource_dir;
        if has_i18n(&dir) {
            return dir;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent().map(|p| p.to_path_buf()) {
            let candidate = exe_dir.join("resources");
            if has_i18n(&candidate) {
                return candidate;
            }
            let mut current = Some(exe_dir);
            for _ in 0..6 {
                let Some(dir) = current.take() else { break };
                let candidate = dir.join("src-tauri").join("resources");
                if has_i18n(&candidate) {
                    return candidate;
                }
                current = dir.parent().map(|p| p.to_path_buf());
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut current = Some(cwd);
        for _ in 0..6 {
            let Some(dir) = current.take() else { break };
            let candidate = dir.join("src-tauri").join("resources");
            if has_i18n(&candidate) {
                return candidate;
            }
            current = dir.parent().map(|p| p.to_path_buf());
        }
    }
    PathBuf::new()
}

fn build_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let resource_dir = resolve_i18n_dir(app_handle);
    let (messages, fallback) = match resolve_portable_paths() {
        Ok((_, settings_dir)) => load_i18n_bundle(&settings_dir, &resource_dir),
        Err(_) => (std::collections::HashMap::new(), std::collections::HashMap::new()),
    };
    let label = |key: &str| t(&messages, &fallback, key);
    let import_evernote =
        MenuItem::with_id(app_handle, FILE_IMPORT_EVERNOTE, label("menu.import_evernote"), true, None::<&str>)?;
    let import_submenu = SubmenuBuilder::new(app_handle, label("menu.import"))
        .item(&import_evernote)
        .build()?;

    let file_menu = SubmenuBuilder::new(app_handle, label("menu.file"))
        .item(&MenuItem::with_id(app_handle, MENU_NEW_NOTE, label("menu.new_note"), true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, MENU_NEW_NOTEBOOK, label("menu.new_notebook"), true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, MENU_NEW_STACK, label("menu.new_stack"), true, None::<&str>)?)
        .separator()
        .item(&import_submenu)
        .separator()
        .item(&MenuItem::with_id(app_handle, MENU_SETTINGS, label("menu.settings"), true, None::<&str>)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app_handle, None)?)
        .item(&PredefinedMenuItem::quit(app_handle, None)?)
        .build()?;

    let detailed_item =
        CheckMenuItem::with_id(app_handle, NOTES_VIEW_DETAILED, label("menu.detailed"), true, true, None::<&str>)?;
    let compact_item =
        CheckMenuItem::with_id(app_handle, NOTES_VIEW_COMPACT, label("menu.compact"), true, false, None::<&str>)?;
    let notes_list_menu = SubmenuBuilder::new(app_handle, label("menu.notes_list"))
        .item(&detailed_item)
        .item(&compact_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app_handle, label("menu.view"))
        .item(&notes_list_menu)
        .build()?;

    let note_menu = SubmenuBuilder::new(app_handle, label("menu.note"))
        .item(&MenuItem::with_id(app_handle, MENU_DELETE_NOTE, label("menu.delete_note"), true, None::<&str>)?)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app_handle, label("menu.tools"))
        .item(&MenuItem::with_id(app_handle, MENU_SEARCH, label("menu.search"), true, None::<&str>)?)
        .build()?;

    MenuBuilder::new(app_handle)
        .item(&file_menu)
        .item(&view_menu)
        .item(&note_menu)
        .item(&tools_menu)
        .build()
}

#[tauri::command]
async fn get_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_notebooks().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn create_notebook(name: String, parentId: Option<i64>, state: State<'_, AppState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.create_notebook(&name, parentId).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_notebook(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_notebook(id).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn move_notebook(
    notebookId: i64,
    parentId: Option<i64>,
    index: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.move_notebook(notebookId, parentId, index)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn move_note(noteId: i64, notebookId: Option<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.update_note_notebook(noteId, notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_notes(notebookId: Option<i64>, state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_all_notes(notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_notes_by_tag(tagId: i64, state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_notes_by_tag(tagId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_trashed_notes(state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_trashed_notes()
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn search_notes(query: String, notebookId: Option<i64>, state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.search_notes(&query, notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note(id: i64, state: State<'_, AppState>) -> Result<Option<Note>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_note(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note_counts(state: State<'_, AppState>) -> Result<NoteCounts, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_note_counts().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_data_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn upsert_note(id: Option<i64>, title: String, content: String, notebookId: Option<i64>, state: State<'_, AppState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    match id {
        Some(id) => {
            repo.update_note(id, &title, &content, notebookId, &state.data_dir)
                .await
                .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            repo.create_note(&title, &content, notebookId, &state.data_dir).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_note(id, &state.data_dir).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn trash_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.trash_note(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.restore_note(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_all_notes(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.restore_all_notes().await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
async fn import_attachment(noteId: i64, sourcePath: String, state: State<'_, AppState>) -> Result<Attachment, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
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
    let rel_dir = PathBuf::from("files").join("attachments").join(id.to_string());
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
async fn import_attachment_bytes(
    noteId: i64,
    filename: String,
    mime: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<Attachment, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
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
    let rel_dir = PathBuf::from("files").join("attachments").join(id.to_string());
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
async fn store_note_file_bytes(
    filename: String,
    mime: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
    store_note_bytes(&state.data_dir, &filename, &mime, &bytes)
}

#[tauri::command]
async fn download_note_file(url: String, state: State<'_, AppState>) -> Result<StoredNoteFile, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    let headers = response.headers().clone();
    if let Some(length) = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
    {
        if length > MAX_NOTE_FILE_BYTES {
            return Err("File exceeds maximum size".to_string());
        }
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_NOTE_FILE_BYTES {
        return Err("File exceeds maximum size".to_string());
    }
    let mime = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let filename = filename_from_url(&url).unwrap_or_else(|| "download".to_string());
    store_note_bytes(&state.data_dir, &filename, mime, &bytes)
}

#[tauri::command]
async fn store_note_file_from_path(source_path: String, state: State<'_, AppState>) -> Result<StoredNoteFile, String> {
    let path = PathBuf::from(&source_path);
    if !path.exists() {
        return Err("Source file not found".to_string());
    }
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    store_note_bytes(&state.data_dir, &filename, &mime, &bytes)
}
#[tauri::command]
async fn delete_attachment(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    let path = repo.delete_attachment(id).await.map_err(|e| e.to_string())?;
    if let Some(rel) = path {
        let full_path = state.data_dir.join(rel);
        if full_path.exists() {
            let _ = fs::remove_file(&full_path);
        }
        if let Some(parent) = full_path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
    Ok(())
}

#[tauri::command]
async fn save_attachment_as(id: i64, dest_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    fs::copy(&source, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn read_attachment_text(id: i64, max_bytes: i64, state: State<'_, AppState>) -> Result<String, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    let file = fs::File::open(&source).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    let limit = max_bytes.max(0) as usize;
    file.take(limit as u64).read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

#[tauri::command]
async fn read_attachment_bytes(id: i64, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    fs::read(&source).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_bytes_as(dest_path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(dest_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    let path = PathBuf::from(path);
    Ok(path.exists())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_is_dir(path: String) -> Result<bool, String> {
    let path = PathBuf::from(path);
    Ok(path.is_dir())
}

#[tauri::command]
fn copy_file(source: String, dest: String) -> Result<(), String> {
    let source = PathBuf::from(source);
    let dest = PathBuf::from(dest);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_dir_size(path: String) -> Result<u64, String> {
    fn dir_size(path: &Path) -> Result<u64, String> {
        if !path.exists() {
            return Ok(0);
        }
        let mut total = 0u64;
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            if meta.is_dir() {
                total += dir_size(&entry.path())?;
            } else {
                total += meta.len();
            }
        }
        Ok(total)
    }
    dir_size(&PathBuf::from(path))
}

#[tauri::command]
fn resolve_resource_roots(path: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut roots = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() && name.to_lowercase().starts_with("user") {
            roots.push(entry.path().to_string_lossy().to_string());
        }
    }
    if roots.is_empty() {
        roots.push(root.to_string_lossy().to_string());
    }
    Ok(roots)
}

#[tauri::command]
fn count_missing_rte(rte_root: String, note_ids: Vec<String>) -> Result<i64, String> {
    let root = PathBuf::from(rte_root);
    let mut missing = 0i64;
    for note_id in note_ids {
        if note_id.len() < 6 {
            missing += 1;
            continue;
        }
        let sub_a = &note_id[0..3];
        let sub_b = &note_id[note_id.len() - 3..];
        let path = root.join(sub_a).join(sub_b).join(format!("{}.dat", note_id));
        if !path.exists() {
            missing += 1;
        }
    }
    Ok(missing)
}

#[tauri::command]
fn create_evernote_backup(state: State<'_, AppState>) -> Result<String, String> {
    let timestamp = chrono::Local::now().format("evernote-%Y%m%d-%H%M%S").to_string();
    let backup_dir = state.data_dir.join("backups").join(timestamp);
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let notes_db = state.data_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, backup_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&state.data_dir.join("files"), &backup_dir.join("files"))?;
    Ok(backup_dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EvernotePaths {
    db_path: Option<String>,
    rte_root: Option<String>,
    resources_root: Option<String>,
}

fn updated_at_ts(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs() as i64)
        .unwrap_or(0)
}

#[allow(non_snake_case)]
#[tauri::command]
fn find_evernote_paths(basePath: String) -> Result<EvernotePaths, String> {
    let base = PathBuf::from(basePath);
    if !base.exists() {
        return Err("Base path not found".to_string());
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(base.clone(), 0)];
    let mut db_candidate: Option<(PathBuf, i64)> = None;
    let mut rte_candidate: Option<(PathBuf, i64)> = None;
    let mut resources_candidate: Option<(PathBuf, i64)> = None;

    const MAX_DEPTH: usize = 6;
    const MAX_ENTRIES: usize = 20000;
    let mut visited = 0usize;

    while let Some((path, depth)) = stack.pop() {
        if visited > MAX_ENTRIES {
            break;
        }
        visited += 1;
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry {
                Ok(value) => value,
                Err(_) => continue,
            };
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if entry_path.is_file() && name.to_lowercase().ends_with("remotegraph.sql") {
                let ts = updated_at_ts(&entry_path);
                if db_candidate.as_ref().map(|(_, best)| ts > *best).unwrap_or(true) {
                    db_candidate = Some((entry_path.clone(), ts));
                }
                continue;
            }
            if entry_path.is_dir() {
                if name.eq_ignore_ascii_case("internal_rteDoc") {
                    let ts = updated_at_ts(&entry_path);
                    if rte_candidate.as_ref().map(|(_, best)| ts > *best).unwrap_or(true) {
                        rte_candidate = Some((entry_path.clone(), ts));
                    }
                } else if name.eq_ignore_ascii_case("resource-cache") {
                    let ts = updated_at_ts(&entry_path);
                    if resources_candidate
                        .as_ref()
                        .map(|(_, best)| ts > *best)
                        .unwrap_or(true)
                    {
                        resources_candidate = Some((entry_path.clone(), ts));
                    }
                }
                if depth < MAX_DEPTH {
                    stack.push((entry_path, depth + 1));
                }
            }
        }
    }

    Ok(EvernotePaths {
        db_path: db_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
        rte_root: rte_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
        resources_root: resources_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
async fn select_evernote_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .pick_folder(move |folder| {
            let path = folder.and_then(|value| value.into_path().ok());
            let _ = tx.send(path.map(|value| value.to_string_lossy().to_string()));
        });
    rx.await.map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EvernoteImportResult {
    notes: i64,
    notebooks: i64,
    tags: i64,
    attachments: i64,
}

#[tauri::command]
async fn import_evernote_from_json(json_path: String, assets_dir: String, state: State<'_, AppState>) -> Result<EvernoteImportResult, String> {
    let raw = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let stacks = data.get("stacks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let notebooks = data.get("notebooks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let notes = data.get("notes").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tags = data.get("tags").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let note_tags = data.get("noteTags").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let attachments = data.get("attachments").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let now = chrono::Utc::now().timestamp();
    let pool = state.pool.clone();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM note_tags").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM attachments").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notes_text").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notes").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM tags").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM notebooks").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM note_files").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ocr_text").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM ocr_files").execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM sqlite_sequence WHERE name IN ('note_tags','attachments','notes_text','notes','tags','notebooks','note_files','ocr_files','ocr_text')")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let mut stack_id_map = std::collections::HashMap::new();
    let mut stack_index = 0i64;
    for stack in &stacks {
        let stack_id = stack.get("id").and_then(|v| v.as_str()).unwrap_or("stack");
        let name = stack.get("name").and_then(|v| v.as_str()).unwrap_or(stack_id);
        sqlx::query(
            "INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order, external_id)
             VALUES (?, ?, NULL, 'stack', ?, ?)",
        )
        .bind(name)
        .bind(now)
        .bind(stack_index)
        .bind(format!("stack:{}", stack_id))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let row_id: (i64,) = sqlx::query_as("SELECT last_insert_rowid()")
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        stack_id_map.insert(stack_id.to_string(), row_id.0);
        stack_index += 1;
    }

    let unsorted_needed = notebooks.iter().any(|nb| {
        let stack_raw = nb.get("personal_Stack_id").and_then(|v| v.as_str());
        normalize_stack_id(stack_raw).is_none()
    });
    if unsorted_needed {
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
    let mut notebook_order: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for nb in &notebooks {
        let stack_raw = nb.get("personal_Stack_id").and_then(|v| v.as_str());
        let stack_id = normalize_stack_id(stack_raw).unwrap_or_else(|| "__unsorted__".to_string());
        let parent_id = stack_id_map.get(&stack_id).copied();
        let index = notebook_order.get(&stack_id).copied().unwrap_or(0);
        let name = nb.get("label")
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
        let title = note.get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let content = note.get("contentNormalized")
            .and_then(|v| v.as_str())
            .or_else(|| note.get("content").and_then(|v| v.as_str()))
            .unwrap_or("");
        let created_at = note.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(now);
        let updated_at = note.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(created_at);
        let notebook_external = note.get("notebookId")
            .and_then(value_to_string)
            .or_else(|| note.get("noteFields").and_then(|v| v.get("parent_Notebook_id")).and_then(value_to_string));
        let notebook_id = notebook_external.as_ref().and_then(|id| notebook_id_map.get(id)).copied();
        let content_hash = note.get("contentHash").and_then(|v| v.as_str()).map(|s| s.to_string());
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
    let roots: Vec<&Value> = tags.iter().filter(|tag| {
        let parent_a = tag.get("parentId").and_then(|v| v.as_i64());
        let parent_b = tag.get("parent_Tag_id").and_then(|v| v.as_i64());
        parent_a.is_none() && parent_b.is_none()
    }).collect();
    for tag in roots {
        let name = tag.get("name")
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

    let children: Vec<&Value> = tags.iter().filter(|tag| {
        let parent_a = tag.get("parentId").and_then(|v| v.as_i64());
        let parent_b = tag.get("parent_Tag_id").and_then(|v| v.as_i64());
        parent_a.is_some() || parent_b.is_some()
    }).collect();
    for tag in children {
        let parent_key = tag.get("parentId").and_then(value_to_string)
            .or_else(|| tag.get("parent_Tag_id").and_then(value_to_string));
        let parent_id = parent_key.as_ref().and_then(|id| tag_id_map.get(id)).copied();
        let name = tag.get("name")
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
        let note_external = nt.get("note_id")
            .or_else(|| nt.get("noteId"))
            .or_else(|| nt.get("Note_id"))
            .and_then(value_to_string);
        let tag_external = nt.get("tag_id")
            .or_else(|| nt.get("tagId"))
            .or_else(|| nt.get("Tag_id"))
            .and_then(value_to_string);
        let note_id = note_external.as_ref().and_then(|id| note_id_map.get(id)).copied();
        let tag_id = tag_external.as_ref().and_then(|id| tag_id_map.get(id)).copied();
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
        let note_external = attachment.get("noteId")
            .or_else(|| fields.get("parent_Note_id"))
            .and_then(value_to_string);
        let note_id = note_external.as_ref().and_then(|id| note_id_map.get(id)).copied();
        if note_id.is_none() {
            continue;
        }
        let hash = attachment.get("dataHash").or_else(|| fields.get("dataHash")).and_then(value_to_string);
        let filename = attachment.get("filename").or_else(|| fields.get("filename")).and_then(|v| v.as_str()).unwrap_or("");
        let mime = attachment.get("mime").or_else(|| fields.get("mime")).and_then(|v| v.as_str()).unwrap_or("");
        let size = attachment.get("dataSize").or_else(|| fields.get("dataSize")).and_then(|v| v.as_i64()).unwrap_or(0);
        let width = fields.get("width").or_else(|| fields.get("imageWidth")).and_then(|v| v.as_i64());
        let height = fields.get("height").or_else(|| fields.get("imageHeight")).and_then(|v| v.as_i64());
        let rel_path = attachment.get("localFile")
            .and_then(|v| v.get("relPath"))
            .and_then(|v| v.as_str())
            .map(|rel| format!("files/{}", rel));
        let source_url = fields.get("sourceUrl")
            .or_else(|| fields.get("sourceURL"))
            .or_else(|| fields.get("source_url"))
            .and_then(|v| v.as_str());
        let is_attachment = fields.get("isAttachment")
            .or_else(|| fields.get("is_attachment"))
            .and_then(|v| v.as_i64())
            .unwrap_or(1);
        let created_at = fields.get("created").or_else(|| fields.get("createdAt")).and_then(|v| v.as_i64()).unwrap_or(now);
        let updated_at = fields.get("updated").or_else(|| fields.get("updatedAt")).and_then(|v| v.as_i64()).unwrap_or(created_at);

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
        .bind(is_attachment)
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
    let repo = SqliteRepository { pool: state.pool.clone() };
    let _ = repo.backfill_note_files_and_ocr(&state.data_dir).await;
    Ok(EvernoteImportResult {
        notes: note_id_map.len() as i64,
        notebooks: notebook_id_map.len() as i64,
        tags: tag_id_map.len() as i64,
        attachments: attachments.len() as i64,
    })
}

#[tauri::command]
async fn run_note_files_backfill(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    match repo.needs_note_files_backfill().await {
        Ok(true) => repo
            .backfill_note_files_and_ocr(&state.data_dir)
            .await
            .map_err(|e| e.to_string()),
        Ok(false) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_ocr_pending_files(limit: Option<i64>, state: State<'_, AppState>) -> Result<Vec<OcrFileItem>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    let limit = limit.unwrap_or(5).max(1);
    repo.get_ocr_pending_files(limit)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn upsert_ocr_text(fileId: i64, lang: String, text: String, hash: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.upsert_ocr_text(fileId, &lang, &text, &hash)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn mark_ocr_failed(fileId: i64, message: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.mark_ocr_failed(fileId, &message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_ocr_stats(state: State<'_, AppState>) -> Result<OcrStats, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_ocr_stats()
        .await
        .map_err(|e| e.to_string())
}


#[tauri::command]
async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_tags().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_note_tags(noteId: i64, state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_note_tags(noteId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn create_tag(name: String, parentId: Option<i64>, state: State<'_, AppState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.create_tag(&name, parentId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn add_note_tag(noteId: i64, tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.add_note_tag(noteId, tagId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn remove_note_tag(noteId: i64, tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.remove_note_tag(noteId, tagId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn delete_tag(tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_tag(tagId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn update_tag_parent(tagId: i64, parentId: Option<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.update_tag_parent(tagId, parentId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let settings_path = state.settings_dir.join(SETTINGS_FILE_NAME);
    if !settings_path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
fn set_settings(settings: Value, state: State<'_, AppState>) -> Result<(), String> {
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

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
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
fn set_storage_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
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

#[tauri::command]
fn set_notes_list_view(view: String, app_handle: AppHandle) -> Result<(), String> {
    update_notes_list_menu(&app_handle, &view);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("notes-file", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            notes_file_response(&state.data_dir, request)
        })
        .setup(|app| {
            let app_handle = app.handle();
            let (data_dir, settings_dir) = match resolve_portable_paths() {
                Ok(paths) => paths,
                Err(err) => {
                    app_handle
                        .dialog()
                        .message(err.clone())
                        .title("Storage Error")
                        .show(|_| {});
                    return Err(err.into());
                }
            };
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(&data_dir).await
            });
            let pool = match pool {
                Ok(pool) => pool,
                Err(err) => {
                    app_handle
                        .dialog()
                        .message(err.clone())
                        .title("Storage Error")
                        .show(|_| {});
                    return Err(err.into());
                }
            };
            app.manage(AppState { pool, settings_dir, data_dir });
            let menu = build_menu(&app_handle)?;
            app.set_menu(menu)?;
            let pool = app.state::<AppState>().pool.clone();
            let data_dir = app.state::<AppState>().data_dir.clone();
            tauri::async_runtime::spawn(async move {
                let repo = SqliteRepository { pool };
                match repo.needs_note_files_backfill().await {
                    Ok(true) => {
                        let _ = repo.backfill_note_files_and_ocr(&data_dir).await;
                    }
                    Ok(false) => {}
                    Err(_) => {}
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app_handle, event| {
            match event.id().0.as_str() {
                FILE_IMPORT_EVERNOTE => {
                    let _ = app_handle.emit("import-evernote", ());
                }
                MENU_NEW_NOTE => {
                    let _ = app_handle.emit("menu-new-note", ());
                }
                MENU_NEW_NOTEBOOK => {
                    let _ = app_handle.emit("menu-new-notebook", ());
                }
                MENU_NEW_STACK => {
                    let _ = app_handle.emit("menu-new-stack", ());
                }
                MENU_DELETE_NOTE => {
                    let _ = app_handle.emit("menu-delete-note", ());
                }
                MENU_SEARCH => {
                    let _ = app_handle.emit("menu-search", ());
                }
                MENU_SETTINGS => {
                    let _ = app_handle.emit("menu-settings", ());
                }
                NOTES_VIEW_DETAILED => {
                    update_notes_list_menu(app_handle, "detailed");
                    let _ = app_handle.emit("notes-list-view", "detailed");
                }
                NOTES_VIEW_COMPACT => {
                    update_notes_list_menu(app_handle, "compact");
                    let _ = app_handle.emit("notes-list-view", "compact");
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_notebooks,
            create_notebook,
            delete_notebook,
            move_notebook,
            move_note,
            get_notes,
            get_notes_by_tag,
            get_trashed_notes,
            search_notes,
            get_note,
            get_note_counts,
            get_data_dir,
            upsert_note,
            delete_note,
            trash_note,
            restore_note,
            restore_all_notes,
            import_attachment,
            import_attachment_bytes,
            store_note_file_bytes,
            download_note_file,
            store_note_file_from_path,
            delete_attachment,
            save_attachment_as,
            read_attachment_text,
            read_attachment_bytes,
            save_bytes_as,
            path_exists,
            path_is_dir,
            ensure_dir,
            read_file_bytes,
            copy_file,
            get_dir_size,
            resolve_resource_roots,
            count_missing_rte,
            get_resource_dir,
            create_evernote_backup,
            find_evernote_paths,
            select_evernote_folder,
            import_evernote_from_json,
            run_note_files_backfill,
            get_ocr_pending_files,
            upsert_ocr_text,
            mark_ocr_failed,
            get_ocr_stats,
            get_tags,
            get_note_tags,
            create_tag,
            add_note_tag,
            remove_note_tag,
            delete_tag,
            update_tag_parent,
            set_notes_list_view,
            get_settings,
            set_settings,
            get_default_storage_path,
            get_storage_override,
            get_storage_info,
            restart_app,
            exit_app,
            set_storage_path,
            set_storage_default,
            set_storage_default_existing,
            set_storage_default_replace,
            set_storage_default_empty,
            set_storage_path_existing,
            set_storage_path_replace,
            set_storage_path_empty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
