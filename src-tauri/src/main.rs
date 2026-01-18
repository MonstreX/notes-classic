#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{
    Attachment, Note, NoteCounts, NoteHistoryItem, NoteListItem, Notebook, OcrFileItem, OcrStats,
    SqliteRepository, Tag,
};
use http::{Request, Response, StatusCode, Uri};
use reqwest;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuItem, MenuItemKind, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

const NOTES_VIEW_DETAILED: &str = "view_notes_detailed";
const NOTES_VIEW_COMPACT: &str = "view_notes_compact";
const SETTINGS_FILE_NAME: &str = "app.json";
const FILE_IMPORT_EVERNOTE: &str = "file_import_evernote";
const FILE_IMPORT_OBSIDIAN: &str = "file_import_obsidian";
const FILE_IMPORT_HTML: &str = "file_import_html";
const FILE_IMPORT_TEXT: &str = "file_import_text";
const FILE_IMPORT_NOTES_CLASSIC: &str = "file_import_notes_classic";
const FILE_EXPORT_NOTES_CLASSIC: &str = "file_export_notes_classic";
const FILE_EXPORT_OBSIDIAN: &str = "file_export_obsidian";
const FILE_EXPORT_HTML: &str = "file_export_html";
const FILE_EXPORT_TEXT: &str = "file_export_text";
const MENU_NEW_NOTE: &str = "menu_new_note";
const MENU_NEW_NOTEBOOK: &str = "menu_new_notebook";
const MENU_NEW_STACK: &str = "menu_new_stack";
const MENU_DELETE_NOTE: &str = "menu_delete_note";
const MENU_SEARCH: &str = "menu_search";
const MENU_HISTORY: &str = "menu_history";
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
    trimmed
        .rsplit('/')
        .next()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn percent_decode_lite(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            let hex = |b: u8| -> Option<u8> {
                match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(10 + b - b'a'),
                    b'A'..=b'F' => Some(10 + b - b'A'),
                    _ => None,
                }
            };
            if let (Some(h), Some(l)) = (hex(hi), hex(lo)) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn extract_rel_from_asset_url(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    if lower.starts_with("files/") || lower.starts_with("./files/") {
        return None;
    }
    if let Some(rest) = lower.strip_prefix("notes-file://files/") {
        return Some(rest.to_string());
    }
    let decoded = percent_decode_lite(url).replace('\\', "/");
    if let Some(idx) = decoded.to_lowercase().find("/files/") {
        return Some(
            decoded[idx + "/files/".len()..]
                .trim_start_matches('/')
                .to_string(),
        );
    }
    if let Some(idx) = lower.find("%2ffiles%2f") {
        let rel = &url[idx + "%2ffiles%2f".len()..];
        let decoded_rel = percent_decode_lite(rel);
        return Some(decoded_rel.trim_start_matches('/').replace('\\', "/"));
    }
    None
}

fn normalize_export_html(html: &str) -> String {
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
        let q = quote.unwrap();
        let remainder = &after[1..];
        if let Some(end) = remainder.find(q) {
            let url = &remainder[..end];
            if let Some(rel) = extract_rel_from_asset_url(url) {
                out.push_str("src=");
                out.push(q);
                out.push_str("files/");
                out.push_str(&rel);
                out.push(q);
            } else if url.starts_with("notes-file://files/") {
                out.push_str("src=");
                out.push(q);
                out.push_str("files/");
                out.push_str(&url["notes-file://files/".len()..]);
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

fn store_note_bytes(
    data_dir: &Path,
    filename: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<StoredNoteFile, String> {
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
    Ok(default_data_dir(&state.settings_dir)
        .to_string_lossy()
        .to_string())
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
async fn clear_storage_for_import(state: State<'_, AppState>) -> Result<(), String> {
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    path: String,
    rel_path: String,
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
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
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
    let mime = match full_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
    {
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

fn find_check_menu_item<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> Option<CheckMenuItem<R>> {
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
    if lang == "ru" {
        "ru".to_string()
    } else {
        "en".to_string()
    }
}

fn load_i18n_bundle(
    settings_dir: &Path,
    resource_dir: &Path,
) -> (
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
) {
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
        Err(_) => (
            std::collections::HashMap::new(),
            std::collections::HashMap::new(),
        ),
    };
    let label = |key: &str| t(&messages, &fallback, key);
    let import_evernote = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_EVERNOTE,
        label("menu.import_evernote"),
        true,
        None::<&str>,
    )?;
    let import_notes_classic = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_NOTES_CLASSIC,
        label("menu.import_notes_classic"),
        true,
        None::<&str>,
    )?;
    let import_obsidian = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_OBSIDIAN,
        label("menu.import_obsidian"),
        true,
        None::<&str>,
    )?;
    let import_html = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_HTML,
        label("menu.import_html"),
        true,
        None::<&str>,
    )?;
    let import_text = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_TEXT,
        label("menu.import_text"),
        true,
        None::<&str>,
    )?;
    let import_submenu = SubmenuBuilder::new(app_handle, label("menu.import"))
        .item(&import_notes_classic)
        .item(&import_evernote)
        .item(&import_obsidian)
        .item(&import_html)
        .item(&import_text)
        .build()?;
    let export_notes_classic = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_NOTES_CLASSIC,
        label("menu.export_notes_classic"),
        true,
        None::<&str>,
    )?;
    let export_obsidian = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_OBSIDIAN,
        label("menu.export_obsidian"),
        true,
        None::<&str>,
    )?;
    let export_html = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_HTML,
        label("menu.export_html"),
        true,
        None::<&str>,
    )?;
    let export_text = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_TEXT,
        label("menu.export_text"),
        true,
        None::<&str>,
    )?;
    let export_submenu = SubmenuBuilder::new(app_handle, label("menu.export"))
        .item(&export_notes_classic)
        .item(&export_obsidian)
        .item(&export_html)
        .item(&export_text)
        .build()?;

    let file_menu = SubmenuBuilder::new(app_handle, label("menu.file"))
        .item(&import_submenu)
        .item(&export_submenu)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_SETTINGS,
            label("menu.settings"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app_handle, None)?)
        .item(&PredefinedMenuItem::quit(app_handle, None)?)
        .build()?;

    let detailed_item = CheckMenuItem::with_id(
        app_handle,
        NOTES_VIEW_DETAILED,
        label("menu.detailed"),
        true,
        true,
        None::<&str>,
    )?;
    let compact_item = CheckMenuItem::with_id(
        app_handle,
        NOTES_VIEW_COMPACT,
        label("menu.compact"),
        true,
        false,
        None::<&str>,
    )?;
    let notes_list_menu = SubmenuBuilder::new(app_handle, label("menu.notes_list"))
        .item(&detailed_item)
        .item(&compact_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app_handle, label("menu.view"))
        .item(&notes_list_menu)
        .build()?;

    let note_menu = SubmenuBuilder::new(app_handle, label("menu.note"))
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_NOTE,
            label("menu.new_note"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_NOTEBOOK,
            label("menu.new_notebook"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_STACK,
            label("menu.new_stack"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_SEARCH,
            label("menu.search"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_HISTORY,
            label("menu.history"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_DELETE_NOTE,
            label("menu.delete_note"),
            true,
            None::<&str>,
        )?)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app_handle, label("menu.tools")).build()?;

    MenuBuilder::new(app_handle)
        .item(&file_menu)
        .item(&view_menu)
        .item(&note_menu)
        .item(&tools_menu)
        .build()
}

#[tauri::command]
async fn get_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_notebooks().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn create_notebook(
    name: String,
    parentId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.create_notebook(&name, parentId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_notebook(id: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.rename_notebook(id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_notebook(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
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
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.move_notebook(notebookId, parentId, index)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn move_note(
    noteId: i64,
    notebookId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.update_note_notebook(noteId, notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_notes(
    notebookId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_all_notes(notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_notes_by_tag(
    tagId: i64,
    state: State<'_, AppState>,
) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_notes_by_tag(tagId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_trashed_notes(state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_trashed_notes().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn search_notes(
    query: String,
    notebookId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.search_notes(&query, notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note(id: i64, state: State<'_, AppState>) -> Result<Option<Note>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note(id).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn search_notes_by_title(
    query: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<db::NoteLinkItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let max = limit.unwrap_or(20).max(1);
    repo.search_notes_by_title(&query, max)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note_id_by_external_id(
    external_id: String,
    state: State<'_, AppState>,
) -> Result<Option<i64>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_id_by_external_id(&external_id)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn set_note_external_id(
    noteId: i64,
    externalId: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.set_note_external_id(noteId, &externalId)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note_counts(state: State<'_, AppState>) -> Result<NoteCounts, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_counts().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_data_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn upsert_note(
    id: Option<i64>,
    title: String,
    content: String,
    notebookId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    match id {
        Some(id) => {
            repo.update_note(id, &title, &content, notebookId, &state.data_dir)
                .await
                .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => repo
            .create_note(&title, &content, notebookId, &state.data_dir)
            .await
            .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
async fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_note(id, &state.data_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn trash_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.trash_note(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.restore_note(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn restore_all_notes(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.restore_all_notes().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_all_trashed_notes(state: State<'_, AppState>) -> Result<i64, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_all_trashed_notes(&state.data_dir)
        .await
        .map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
async fn import_attachment(
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
async fn import_attachment_bytes(
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
async fn store_note_file_bytes(
    filename: String,
    mime: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
    store_note_bytes(&state.data_dir, &filename, &mime, &bytes)
}

#[tauri::command]
async fn download_note_file(
    url: String,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
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
async fn store_note_file_from_path(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
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
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let path = repo
        .delete_attachment(id)
        .await
        .map_err(|e| e.to_string())?;
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
async fn save_attachment_as(
    id: i64,
    dest_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
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
async fn read_attachment_text(
    id: i64,
    max_bytes: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
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
    file.take(limit as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

#[tauri::command]
async fn read_attachment_bytes(id: i64, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
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
fn list_files_recursive(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut stack = vec![root_path.clone()];
    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if name == ".obsidian" {
                    continue;
                }
                if name.starts_with('.') {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            let rel_path = path
                .strip_prefix(&root_path)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            entries.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                rel_path,
            });
        }
    }
    Ok(entries)
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
async fn get_attachment_by_path(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<Attachment>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let normalized = path.replace('\\', "/");
    let normalized = if normalized.starts_with("files/") {
        normalized
    } else {
        format!("files/{}", normalized.trim_start_matches('/'))
    };
    repo.get_attachment_by_path(&normalized)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn add_history_entry(
    noteId: i64,
    minGapSeconds: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.add_history_entry(noteId, minGapSeconds)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note_history(
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> Result<Vec<NoteHistoryItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_history(limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_note_history(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.clear_note_history().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cleanup_note_history(days: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.cleanup_note_history(days)
        .await
        .map_err(|e| e.to_string())
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
        let path = root
            .join(sub_a)
            .join(sub_b)
            .join(format!("{}.dat", note_id));
        if !path.exists() {
            missing += 1;
        }
    }
    Ok(missing)
}

#[tauri::command]
fn create_evernote_backup(state: State<'_, AppState>) -> Result<String, String> {
    let timestamp = chrono::Local::now()
        .format("evernote-%Y%m%d-%H%M%S")
        .to_string();
    let backup_dir = state.data_dir.join("backups").join(timestamp);
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
fn create_import_backup(kind: String, state: State<'_, AppState>) -> Result<String, String> {
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
fn restore_import_backup(backup_dir: String, state: State<'_, AppState>) -> Result<(), String> {
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
                if db_candidate
                    .as_ref()
                    .map(|(_, best)| ts > *best)
                    .unwrap_or(true)
                {
                    db_candidate = Some((entry_path.clone(), ts));
                }
                continue;
            }
            if entry_path.is_dir() {
                if name.eq_ignore_ascii_case("internal_rteDoc") {
                    let ts = updated_at_ts(&entry_path);
                    if rte_candidate
                        .as_ref()
                        .map(|(_, best)| ts > *best)
                        .unwrap_or(true)
                    {
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
    app_handle.dialog().file().pick_folder(move |folder| {
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
async fn import_evernote_from_json(
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
            .unwrap_or_else(|| mime_lc.map_or(false, |lower| !lower.starts_with("image/")));
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

#[tauri::command]
async fn select_obsidian_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .set_title("Select Markdown folder")
        .pick_folder(move |folder| {
            let path = folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn select_html_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .set_title("Select HTML folder")
        .pick_folder(move |folder| {
            let path = folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn select_text_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .set_title("Select text folder")
        .pick_folder(move |folder| {
            let path = folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn select_export_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx): (
        tokio::sync::oneshot::Sender<Option<String>>,
        tokio::sync::oneshot::Receiver<Option<String>>,
    ) = tokio::sync::oneshot::channel();
    app_handle
        .dialog()
        .file()
        .set_title("Select export folder")
        .pick_folder(move |folder| {
            let path = folder
                .and_then(|path| path.into_path().ok())
                .map(|path| path.to_string_lossy().to_string());
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn select_notes_classic_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
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

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportNotebook {
    id: i64,
    name: String,
    created_at: i64,
    parent_id: Option<i64>,
    notebook_type: String,
    sort_order: i64,
    external_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ExportNote {
    id: i64,
    title: String,
    created_at: i64,
    updated_at: i64,
    sync_status: Option<i64>,
    remote_id: Option<String>,
    notebook_id: Option<i64>,
    external_id: Option<String>,
    meta: Option<String>,
    content_hash: Option<String>,
    content_size: Option<i64>,
    deleted_at: Option<i64>,
    deleted_from_notebook_id: Option<i64>,
    content_path: String,
    meta_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportNoteText {
    note_id: i64,
    title: String,
    plain_text: String,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportTag {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    created_at: i64,
    updated_at: i64,
    external_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportNoteTag {
    note_id: i64,
    tag_id: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportAttachment {
    id: i64,
    note_id: i64,
    external_id: Option<String>,
    hash: Option<String>,
    filename: Option<String>,
    mime: Option<String>,
    size: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
    local_path: Option<String>,
    source_url: Option<String>,
    is_attachment: Option<i64>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    export_path: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportOcrFile {
    id: i64,
    file_path: String,
    attempts_left: i64,
    last_error: Option<String>,
    export_path: String,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportNoteFile {
    note_id: i64,
    file_id: i64,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportOcrText {
    file_id: i64,
    lang: String,
    text: String,
    hash: String,
    updated_at: i64,
}

#[derive(serde::Serialize, serde::Deserialize, sqlx::FromRow)]
struct ExportHistory {
    id: i64,
    note_id: i64,
    opened_at: i64,
    note_title: String,
    notebook_id: Option<i64>,
    notebook_name: Option<String>,
    stack_id: Option<i64>,
    stack_name: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportManifest {
    version: String,
    exported_at: String,
    notebooks: Vec<ExportNotebook>,
    notes: Vec<ExportNote>,
    notes_text: Vec<ExportNoteText>,
    tags: Vec<ExportTag>,
    note_tags: Vec<ExportNoteTag>,
    attachments: Vec<ExportAttachment>,
    ocr_files: Vec<ExportOcrFile>,
    note_files: Vec<ExportNoteFile>,
    ocr_text: Vec<ExportOcrText>,
    note_history: Vec<ExportHistory>,
}

#[derive(serde::Serialize)]
struct NotesClassicImportResult {
    notes: i64,
    notebooks: i64,
    tags: i64,
    attachments: i64,
    images: i64,
    errors: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
struct NotesClassicImportProgress {
    stage: String,
    current: i64,
    total: i64,
    state: String,
    message: Option<String>,
}

#[derive(serde::Serialize)]
struct ExportReport {
    export_root: String,
    manifest_path: String,
    notes: i64,
    notebooks: i64,
    tags: i64,
    attachments: i64,
    images: i64,
    errors: Vec<String>,
}

#[tauri::command]
async fn export_notes_classic(
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

async fn update_sqlite_sequence(
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

fn attachment_export_to_storage_path(export_path: &str) -> String {
    let cleaned = export_path.replace('\\', "/");
    let rel = cleaned
        .trim_start_matches("attachments/")
        .trim_start_matches("files/")
        .trim_start_matches('/');
    format!("files/{}", rel)
}

#[tauri::command]
async fn import_notes_classic_from_manifest(
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
        .bind(&item.stack_id)
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

#[tauri::command]
async fn run_note_files_backfill(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
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
async fn get_ocr_pending_files(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<OcrFileItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let limit = limit.unwrap_or(5).max(1);
    repo.get_ocr_pending_files(limit)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn upsert_ocr_text(
    fileId: i64,
    lang: String,
    text: String,
    hash: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.upsert_ocr_text(fileId, &lang, &text, &hash)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn mark_ocr_failed(
    fileId: i64,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.mark_ocr_failed(fileId, &message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_ocr_stats(state: State<'_, AppState>) -> Result<OcrStats, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_ocr_stats().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_tags().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_note_tags(noteId: i64, state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_tags(noteId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn create_tag(
    name: String,
    parentId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.create_tag(&name, parentId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn add_note_tag(noteId: i64, tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.add_note_tag(noteId, tagId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn remove_note_tag(
    noteId: i64,
    tagId: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.remove_note_tag(noteId, tagId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn delete_tag(tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_tag(tagId).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn update_tag_parent(
    tagId: i64,
    parentId: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.update_tag_parent(tagId, parentId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn rename_tag(tagId: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.rename_tag(tagId, &name)
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
            let pool = tauri::async_runtime::block_on(async { db::init_db(&data_dir).await });
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
            app.manage(AppState {
                pool,
                settings_dir,
                data_dir,
            });
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
        .on_menu_event(|app_handle, event| match event.id().0.as_str() {
            FILE_IMPORT_EVERNOTE => {
                let _ = app_handle.emit("import-evernote", ());
            }
            FILE_IMPORT_NOTES_CLASSIC => {
                let _ = app_handle.emit("import-notes-classic", ());
            }
            FILE_IMPORT_OBSIDIAN => {
                let _ = app_handle.emit("import-obsidian", ());
            }
            FILE_IMPORT_HTML => {
                let _ = app_handle.emit("import-html", ());
            }
            FILE_IMPORT_TEXT => {
                let _ = app_handle.emit("import-text", ());
            }
            FILE_EXPORT_NOTES_CLASSIC => {
                let _ = app_handle.emit("export-notes-classic", ());
            }
            FILE_EXPORT_OBSIDIAN => {
                let _ = app_handle.emit("export-obsidian", ());
            }
            FILE_EXPORT_HTML => {
                let _ = app_handle.emit("export-html", ());
            }
            FILE_EXPORT_TEXT => {
                let _ = app_handle.emit("export-text", ());
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
            MENU_HISTORY => {
                let _ = app_handle.emit("menu-history", ());
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
        })
        .invoke_handler(tauri::generate_handler![
            get_notebooks,
            create_notebook,
            rename_notebook,
            delete_notebook,
            move_notebook,
            move_note,
            get_notes,
            get_notes_by_tag,
            get_trashed_notes,
            search_notes,
            search_notes_by_title,
            get_note,
            get_note_id_by_external_id,
            set_note_external_id,
            get_note_counts,
            get_data_dir,
            upsert_note,
            delete_note,
            trash_note,
            restore_note,
            restore_all_notes,
            delete_all_trashed_notes,
            import_attachment,
            import_attachment_bytes,
            store_note_file_bytes,
            download_note_file,
            store_note_file_from_path,
            delete_attachment,
            save_attachment_as,
            read_attachment_text,
            read_attachment_bytes,
            get_attachment_by_path,
            save_bytes_as,
            add_history_entry,
            get_note_history,
            clear_note_history,
            cleanup_note_history,
            path_exists,
            list_files_recursive,
            path_is_dir,
            ensure_dir,
            read_file_bytes,
            copy_file,
            get_dir_size,
            resolve_resource_roots,
            count_missing_rte,
            get_resource_dir,
            create_evernote_backup,
            create_import_backup,
            restore_import_backup,
            find_evernote_paths,
            select_evernote_folder,
            select_notes_classic_folder,
            select_obsidian_folder,
            select_html_folder,
            select_text_folder,
            select_export_folder,
            export_notes_classic,
            import_notes_classic_from_manifest,
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
            rename_tag,
            set_notes_list_view,
            get_settings,
            set_settings,
            get_default_storage_path,
            get_storage_override,
            get_storage_info,
            clear_storage_for_import,
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
