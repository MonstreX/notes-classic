use super::*;
use crate::services::prelude::*;

#[allow(non_snake_case)]
#[tauri::command]
pub async fn add_history_entry(
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
pub async fn get_note_history(
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
pub async fn clear_note_history(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.clear_note_history().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn cleanup_note_history(days: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.cleanup_note_history(days)
        .await
        .map_err(|e| e.to_string())
}
