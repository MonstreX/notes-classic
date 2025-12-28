#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{Note, NoteCounts, NoteListItem, Notebook, OcrFileItem, OcrStats, SqliteRepository, Tag};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use http::{Request, Response, StatusCode, Uri};
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuItem, MenuItemKind, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

const NOTES_VIEW_DETAILED: &str = "view_notes_detailed";
const NOTES_VIEW_COMPACT: &str = "view_notes_compact";
const SETTINGS_FILE_NAME: &str = "app.json";
const FILE_IMPORT_EVERNOTE: &str = "file_import_evernote";

struct AppState {
    pool: sqlx::sqlite::SqlitePool,
    settings_dir: PathBuf,
    data_dir: PathBuf,
}

fn ensure_dir_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let test_path = dir.join(".write_test");
    fs::write(&test_path, b"test").map_err(|e| e.to_string())?;
    fs::remove_file(&test_path).map_err(|e| e.to_string())?;
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
    ensure_dir_writable(&data_dir)?;
    ensure_dir_writable(&settings_dir)?;

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
        .item(&MenuItem::with_id(app_handle, "file_new", "New", true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "file_open", "Open...", true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "file_save", "Save", true, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "file_save_as", "Save As...", true, None::<&str>)?)
        .separator()
        .item(&import_submenu)
        .separator()
        .item(&MenuItem::with_id(app_handle, "file_settings", "Settings", true, None::<&str>)?)
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
        .item(&MenuItem::with_id(app_handle, "view_toggle_sidebar", "Toggle Sidebar", false, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "view_toggle_list", "Toggle Notes List", false, None::<&str>)?)
        .separator()
        .item(&notes_list_menu)
        .separator()
        .item(&MenuItem::with_id(app_handle, "view_actual_size", "Actual Size", false, None::<&str>)?)
        .build()?;

    let note_menu = SubmenuBuilder::new(app_handle, "Note")
        .item(&MenuItem::with_id(app_handle, "note_new", "New Note", false, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "note_delete", "Delete Note", false, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "note_move", "Move To...", false, None::<&str>)?)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app_handle, "Tools")
        .item(&MenuItem::with_id(app_handle, "tools_import", "Import", false, None::<&str>)?)
        .item(&MenuItem::with_id(app_handle, "tools_export", "Export", false, None::<&str>)?)
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
    repo.delete_note(id).await.map_err(|e| e.to_string())
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
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
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
            app.manage(AppState { pool, settings_dir, data_dir });
            let pool = app.state::<AppState>().pool.clone();
            let data_dir = app.state::<AppState>().data_dir.clone();
            tauri::async_runtime::spawn(async move {
                let repo = SqliteRepository { pool };
                let _ = repo.backfill_note_files_and_ocr(&data_dir).await;
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
            search_notes,
            get_note,
            get_note_counts,
            get_data_dir,
            upsert_note,
            delete_note,
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
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
