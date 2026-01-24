use crate::services::prelude::*;

#[tauri::command]
pub async fn select_obsidian_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
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
pub async fn select_html_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
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
pub async fn select_text_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
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
pub async fn select_export_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
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
