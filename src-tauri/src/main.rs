#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{Note, NoteCounts, NoteListItem, Notebook, SqliteRepository};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{api::dialog::blocking::message, AppHandle, CustomMenuItem, Manager, Menu, MenuItem, State, Submenu};
use tauri::http::status::StatusCode;
use tauri::http::{Response, ResponseBuilder, Uri};

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
    let data_dir = exe_dir.join("data");
    let settings_dir = exe_dir.join("settings");
    ensure_dir_writable(&data_dir)?;
    ensure_dir_writable(&settings_dir)?;

    let legacy_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to resolve app data directory".to_string())?;
    let legacy_db = legacy_dir.join("notes_classic.db");
    let new_db = data_dir.join("notes.db");
    if !new_db.exists() && legacy_db.exists() {
        fs::copy(&legacy_db, &new_db).map_err(|e| e.to_string())?;
    }

    Ok((data_dir, settings_dir))
}

fn notes_file_response(data_dir: &Path, request: &tauri::http::Request) -> Result<Response, Box<dyn std::error::Error>> {
    let uri: Uri = request.uri().parse()?;
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
        return Ok(ResponseBuilder::new().status(StatusCode::BAD_REQUEST).body(Vec::new())?);
    }
    let full_path = data_dir.join(rel);
    if !full_path.exists() {
        return Ok(ResponseBuilder::new().status(StatusCode::NOT_FOUND).body(Vec::new())?);
    }
    let bytes = fs::read(&full_path)?;
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
    Ok(ResponseBuilder::new()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .body(bytes)?)
}

fn update_notes_list_menu(app_handle: &AppHandle, view: &str) {
    if let Some(window) = app_handle.get_window("main") {
        let menu = window.menu_handle();
        let _ = menu.get_item(NOTES_VIEW_DETAILED).set_selected(view == "detailed");
        let _ = menu.get_item(NOTES_VIEW_COMPACT).set_selected(view == "compact");
    }
}

fn build_menu() -> Menu {
    let import_menu = Menu::new()
        .add_item(CustomMenuItem::new("file_import_evernote".to_string(), "Evernote..."));

    let file_menu = Menu::new()
        .add_item(CustomMenuItem::new("file_new".to_string(), "New"))
        .add_item(CustomMenuItem::new("file_open".to_string(), "Open..."))
        .add_item(CustomMenuItem::new("file_save".to_string(), "Save"))
        .add_item(CustomMenuItem::new("file_save_as".to_string(), "Save As..."))
        .add_native_item(MenuItem::Separator)
        .add_submenu(Submenu::new("Import", import_menu))
        .add_native_item(MenuItem::Separator)
        .add_item(CustomMenuItem::new("file_settings".to_string(), "Settings"))
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::CloseWindow)
        .add_native_item(MenuItem::Quit);

    let notes_list_menu = Menu::new()
        .add_item(CustomMenuItem::new(NOTES_VIEW_DETAILED.to_string(), "Detailed").selected())
        .add_item(CustomMenuItem::new(NOTES_VIEW_COMPACT.to_string(), "Compact"));

    let view_menu = Menu::new()
        .add_item(CustomMenuItem::new("view_toggle_sidebar".to_string(), "Toggle Sidebar").disabled())
        .add_item(CustomMenuItem::new("view_toggle_list".to_string(), "Toggle Notes List").disabled())
        .add_native_item(MenuItem::Separator)
        .add_submenu(Submenu::new("Notes List", notes_list_menu))
        .add_native_item(MenuItem::Separator)
        .add_item(CustomMenuItem::new("view_actual_size".to_string(), "Actual Size").disabled());

    let note_menu = Menu::new()
        .add_item(CustomMenuItem::new("note_new".to_string(), "New Note").disabled())
        .add_item(CustomMenuItem::new("note_delete".to_string(), "Delete Note").disabled())
        .add_item(CustomMenuItem::new("note_move".to_string(), "Move To...").disabled());

    let tools_menu = Menu::new()
        .add_item(CustomMenuItem::new("tools_import".to_string(), "Import").disabled())
        .add_item(CustomMenuItem::new("tools_export".to_string(), "Export").disabled());

    Menu::new()
        .add_submenu(Submenu::new("File", file_menu))
        .add_submenu(Submenu::new("View", view_menu))
        .add_submenu(Submenu::new("Note", note_menu))
        .add_submenu(Submenu::new("Tools", tools_menu))
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
            repo.update_note(id, &title, &content, notebookId)
                .await
                .map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            repo.create_note(&title, &content, notebookId).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_note(id).await.map_err(|e| e.to_string())
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
    let menu = build_menu();
    tauri::Builder::default()
        .register_uri_scheme_protocol("notes-file", |app, request| {
            let state = app.state::<AppState>();
            notes_file_response(&state.data_dir, request)
        })
        .setup(|app| {
            let app_handle = app.handle();
            let (data_dir, settings_dir) = match resolve_portable_paths(&app_handle) {
                Ok(paths) => paths,
                Err(err) => {
                    message(None::<&tauri::Window>, "Storage Error", err.as_str());
                    return Err(err.into());
                }
            };
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(&data_dir).await
            });
            app.manage(AppState { pool, settings_dir, data_dir });
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(menu)
        .on_menu_event(|event| {
            let app_handle = event.window().app_handle();
            match event.menu_item_id() {
                FILE_IMPORT_EVERNOTE => {
                    let _ = app_handle.emit_all("import-evernote", ());
                }
                NOTES_VIEW_DETAILED => {
                    update_notes_list_menu(&app_handle, "detailed");
                    let _ = app_handle.emit_all("notes-list-view", "detailed");
                }
                NOTES_VIEW_COMPACT => {
                    update_notes_list_menu(&app_handle, "compact");
                    let _ = app_handle.emit_all("notes-list-view", "compact");
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
            get_note,
            get_note_counts,
            get_data_dir,
            upsert_note,
            delete_note,
            set_notes_list_view,
            get_settings,
            set_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
