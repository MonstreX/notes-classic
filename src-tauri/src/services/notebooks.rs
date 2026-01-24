use super::*;
use crate::services::prelude::*;

#[tauri::command]
pub async fn get_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_notebooks().await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn create_notebook(
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
pub async fn rename_notebook(
    id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.rename_notebook(id, &name)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn delete_notebook(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.delete_notebook(id).await.map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn move_notebook(
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
