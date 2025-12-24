#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{DbState, Note, Notebook, SqliteRepository};
use tauri::{Manager, State};

#[tauri::command]
async fn get_notebooks(state: State<'_, DbState>) -> Result<Vec<Notebook>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_notebooks().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_notebook(name: String, parent_id: Option<i64>, state: State<'_, DbState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.create_notebook(&name, parent_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_notebook(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_notebook(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_note(note_id: i64, notebook_id: Option<i64>, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.update_note_notebook(note_id, notebook_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_notes(notebook_id: Option<i64>, state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.get_all_notes(notebook_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn upsert_note(id: Option<i64>, title: String, content: String, notebook_id: Option<i64>, state: State<'_, DbState>) -> Result<i64, String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    match id {
        Some(id) => {
            repo.update_note(id, &title, &content, notebook_id).await.map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            repo.create_note(&title, &content, notebook_id).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn delete_note(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteRepository { pool: state.pool.clone() };
    repo.delete_note(id).await.map_err(|e| e.to_string())
}

fn main() {
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
        .invoke_handler(tauri::generate_handler![
            get_notebooks,
            create_notebook,
            delete_notebook,
            move_note,
            get_notes,
            upsert_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}