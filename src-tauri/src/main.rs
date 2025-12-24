#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{DbState, Note, NoteRepository, SqliteNoteRepository};
use tauri::{Manager, State};

#[tauri::command]
async fn get_notes(state: State<'_, DbState>) -> Result<Vec<Note>, String> {
    let repo = SqliteNoteRepository { pool: state.pool.clone() };
    repo.get_all_notes().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_note(id: i64, state: State<'_, DbState>) -> Result<Note, String> {
    let repo = SqliteNoteRepository { pool: state.pool.clone() };
    repo.get_note_by_id(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn upsert_note(id: Option<i64>, title: String, content: String, state: State<'_, DbState>) -> Result<i64, String> {
    let repo = SqliteNoteRepository { pool: state.pool.clone() };
    match id {
        Some(id) => {
            repo.update_note(id, &title, &content).await.map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            repo.create_note(&title, &content).await.map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn delete_note(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let repo = SqliteNoteRepository { pool: state.pool.clone() };
    repo.delete_note(id).await.map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let app_dir = app_handle.path_resolver().app_data_dir().expect("failed to get app data dir");
            
            // Используем рантайм Tauri для инициализации БД
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(&app_dir).await
            });
            
            app.manage(DbState { pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_notes,
            get_note,
            upsert_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}