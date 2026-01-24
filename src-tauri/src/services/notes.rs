use super::*;
use crate::services::prelude::*;

#[allow(non_snake_case)]
#[tauri::command]
pub async fn move_note(
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
pub async fn get_notes(
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
pub async fn get_notes_by_tag(
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
pub async fn get_trashed_notes(state: State<'_, AppState>) -> Result<Vec<NoteListItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_trashed_notes().await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn search_notes(
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
pub async fn get_note(id: i64, state: State<'_, AppState>) -> Result<Option<Note>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note(id).await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn search_notes_by_title(
    query: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::NoteLinkItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let max = limit.unwrap_or(20).max(1);
    repo.search_notes_by_title(&query, max)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_note_id_by_external_id(
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
pub async fn set_note_external_id(
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
pub async fn get_note_counts(state: State<'_, AppState>) -> Result<NoteCounts, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_counts().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_data_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn upsert_note(
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
pub async fn delete_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_note(id, &state.data_dir)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn trash_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.trash_note(id).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn restore_note(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.restore_note(id).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn restore_all_notes(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.restore_all_notes().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_all_trashed_notes(state: State<'_, AppState>) -> Result<i64, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_all_trashed_notes(&state.data_dir)
        .await
        .map_err(|e| e.to_string())
}
