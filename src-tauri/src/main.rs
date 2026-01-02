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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    has_data: bool,
    notes_count: i64,
    notebooks_count: i64,
    last_note_at: Option<i64>,
    last_note_title: Option<String>,
}

#[derive(serde::Serialize)]
struct StoredNoteFile {
    rel_path: String,
    hash: String,
    mime: String,
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
    let has_data = db_path.exists() || target.join("files").exists() || target.join("ocr").exists();
    if !db_path.exists() {
        return Ok(StorageInfo {
            has_data,
            notes_count: 0,
            notebooks_count: 0,
            last_note_at: None,
            last_note_title: None,
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
    let notes_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
    let notebooks_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notebooks WHERE notebook_type = 'notebook'")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
    let last_note_at: Option<i64> =
        sqlx::query_scalar("SELECT MAX(updated_at) FROM notes WHERE deleted_at IS NULL")
            .fetch_one(&pool)
            .await
            .unwrap_or(None);
    let last_note_title: Option<String> =
        sqlx::query_scalar("SELECT title FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1")
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
    Ok(StorageInfo {
        has_data,
        notes_count,
        notebooks_count,
        last_note_at,
        last_note_title,
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
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() || new_dir.join("ocr").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;
    copy_dir_recursive(&current_dir.join("ocr"), &new_dir.join("ocr"))?;

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
    copy_dir_recursive(&current_dir.join("ocr"), &new_dir.join("ocr"))?;

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
    copy_dir_recursive(&current_dir.join("ocr"), &new_dir.join("ocr"))?;

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

fn resolve_portable_paths(app_handle: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
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

    let legacy_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to resolve app data directory".to_string())?;
    let legacy_db = legacy_dir.join("notes_classic.db");
    let new_db = data_dir.join("notes.db");
    if !new_db.exists() && legacy_db.exists() {
        fs::copy(&legacy_db, &new_db).map_err(|e| e.to_string())?;
    }

    Ok((data_dir, settings_dir))
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

fn build_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let import_evernote =
        MenuItem::with_id(app_handle, FILE_IMPORT_EVERNOTE, "Evernote...", true, None::<&str>)?;
    let import_submenu = SubmenuBuilder::new(app_handle, "Import")
        .item(&import_evernote)
        .build()?;

    let file_menu = SubmenuBuilder::new(app_handle, "File")
        .item(&MenuItem::with_id(app_handle, MENU_NEW_NOTE, "New Note", true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, MENU_NEW_NOTEBOOK, "New Notebook", true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, MENU_NEW_STACK, "New Stack", true, None::<&str>)?)
        .separator()
        .item(&import_submenu)
        .separator()
        .item(&MenuItem::with_id(app_handle, MENU_SETTINGS, "Settings", true, None::<&str>)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app_handle, None)?)
        .item(&PredefinedMenuItem::quit(app_handle, None)?)
        .build()?;

    let detailed_item =
        CheckMenuItem::with_id(app_handle, NOTES_VIEW_DETAILED, "Detailed", true, true, None::<&str>)?;
    let compact_item =
        CheckMenuItem::with_id(app_handle, NOTES_VIEW_COMPACT, "Compact", true, false, None::<&str>)?;
    let notes_list_menu = SubmenuBuilder::new(app_handle, "Notes List")
        .item(&detailed_item)
        .item(&compact_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app_handle, "View")
        .item(&notes_list_menu)
        .build()?;

    let note_menu = SubmenuBuilder::new(app_handle, "Note")
        .item(&MenuItem::with_id(app_handle, MENU_DELETE_NOTE, "Delete Note", true, None::<&str>)?)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app_handle, "Tools")
        .item(&MenuItem::with_id(app_handle, MENU_SEARCH, "Search", true, None::<&str>)?)
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
    if new_dir.join("notes.db").exists() || new_dir.join("files").exists() || new_dir.join("ocr").exists() {
        return Err("Target folder already contains data".to_string());
    }
    let notes_db = current_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, new_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&current_dir.join("files"), &new_dir.join("files"))?;
    copy_dir_recursive(&current_dir.join("ocr"), &new_dir.join("ocr"))?;

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
            let (data_dir, settings_dir) = match resolve_portable_paths(&app_handle) {
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
        .menu(|app_handle| build_menu(app_handle))
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
            set_storage_path,
            set_storage_default,
            set_storage_default_existing,
            set_storage_default_replace,
            set_storage_path_existing,
            set_storage_path_replace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
