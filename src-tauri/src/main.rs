#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{DbState, Note, Notebook, SqliteRepository};
use tauri::{CustomMenuItem, Manager, Menu, MenuItem, State, Submenu};

fn build_menu() -> Menu {
    let file_menu = Menu::new()
        .add_item(CustomMenuItem::new("file_new".to_string(), "New"))
        .add_item(CustomMenuItem::new("file_open".to_string(), "Open..."))
        .add_item(CustomMenuItem::new("file_save".to_string(), "Save"))
        .add_item(CustomMenuItem::new("file_save_as".to_string(), "Save As..."))
        .add_native_item(MenuItem::Separator)
        .add_item(CustomMenuItem::new("file_settings".to_string(), "Settings"))
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::CloseWindow)
        .add_native_item(MenuItem::Quit);

    let view_menu = Menu::new()
        .add_item(CustomMenuItem::new("view_toggle_sidebar".to_string(), "Toggle Sidebar").disabled())
        .add_item(CustomMenuItem::new("view_toggle_list".to_string(), "Toggle Notes List").disabled())
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
async fn get_notebooks(state: State<'_, DbState>) -> Result<Vec<Notebook>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_notebooks().await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn create_notebook(name: String, parentId: Option<i64>, state: State<'_, DbState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.create_notebook(&name, parentId).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_notebook(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_notebook(id).await.map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn move_notebook(
    notebookId: i64,
    parentId: Option<i64>,
    index: usize,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.move_notebook(notebookId, parentId, index)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn move_note(noteId: i64, notebookId: Option<i64>, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.update_note_notebook(noteId, notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn get_notes(notebookId: Option<i64>, state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_all_notes(notebookId)
        .await
        .map_err(|e| e.to_string())
}

#[allow(non_snake_case)]
#[tauri::command]
async fn upsert_note(id: Option<i64>, title: String, content: String, notebookId: Option<i64>, state: State<'_, DbState>) -> Result<i64, String> {
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
async fn delete_note(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_note(id).await.map_err(|e| e.to_string())
}

fn main() {
    let menu = build_menu();
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let app_dir = app_handle.path_resolver().app_data_dir().expect("failed to get app data dir");
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(&app_dir).await
            });
            app.manage(DbState { pool });
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(menu)
        .invoke_handler(tauri::generate_handler![
            get_notebooks,
            create_notebook,
            delete_notebook,
            move_notebook,
            move_note,
            get_notes,
            upsert_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
