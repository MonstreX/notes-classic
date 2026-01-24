use super::*;
use crate::services::prelude::*;

#[tauri::command]
pub async fn get_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_tags().await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn get_note_tags(noteId: i64, state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_note_tags(noteId).await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn create_tag(
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
pub async fn add_note_tag(
    noteId: i64,
    tagId: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.add_note_tag(noteId, tagId)
        .await
        .map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn remove_note_tag(
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
pub async fn delete_tag(tagId: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_tag(tagId).await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn update_tag_parent(
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
pub async fn rename_tag(
    tagId: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.rename_tag(tagId, &name)
        .await
        .map_err(|e| e.to_string())
}
