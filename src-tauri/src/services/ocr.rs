use super::*;
use crate::services::prelude::*;

#[derive(serde::Serialize, Clone)]
pub struct ResourceDownloadProgress {
    stage: String,
    current: u64,
    total: u64,
    file: String,
    index: u32,
    count: u32,
}
pub async fn download_with_progress(
    client: &reqwest::Client,
    app_handle: &AppHandle,
    stage: &str,
    url: &str,
    dest: &Path,
    index: u32,
    count: u32,
    current: &mut u64,
    total: u64,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: {} {}", response.status(), url));
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e: reqwest::Error| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        *current += chunk.len() as u64;
        let event_name = format!("{}-download-progress", stage);
        let _ = app_handle.emit(
            event_name.as_str(),
            ResourceDownloadProgress {
                stage: stage.to_string(),
                current: *current,
                total,
                file: url.to_string(),
                index,
                count,
            },
        );
    }
    Ok(())
}
pub async fn content_length(client: &reqwest::Client, url: &str) -> Option<u64> {
    client.head(url).send().await.ok().and_then(|resp| {
        resp.headers()
            .get(reqwest::header::CONTENT_LENGTH)?
            .to_str()
            .ok()?
            .parse()
            .ok()
    })
}
#[tauri::command]
pub async fn download_ocr_resources(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let base = state.data_dir.join("resources").join("ocr");
    let items = vec![
        (
            "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
            "worker.min.js",
        ),
        (
            "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core.wasm.js",
            "tesseract-core.wasm.js",
        ),
        (
            "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core.wasm",
            "tesseract-core.wasm",
        ),
        (
            "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz",
            "tessdata/eng.traineddata.gz",
        ),
        (
            "https://tessdata.projectnaptha.com/4.0.0/rus.traineddata.gz",
            "tessdata/rus.traineddata.gz",
        ),
    ];
    let client = reqwest::Client::new();
    let mut total: u64 = 0;
    for (url, _) in &items {
        if let Some(size) = content_length(&client, url).await {
            total += size;
        }
    }
    let mut current: u64 = 0;
    for (idx, (url, rel)) in items.iter().enumerate() {
        let dest = base.join(rel);
        download_with_progress(
            &client,
            &app_handle,
            "ocr",
            url,
            &dest,
            idx as u32 + 1,
            items.len() as u32,
            &mut current,
            total,
        )
        .await?;
    }
    Ok(())
}
#[tauri::command]
pub async fn run_note_files_backfill(state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    match repo.needs_note_files_backfill().await {
        Ok(true) => repo
            .backfill_note_files_and_ocr(&state.data_dir)
            .await
            .map_err(|e| e.to_string()),
        Ok(false) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub async fn get_ocr_pending_files(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<OcrFileItem>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let limit = limit.unwrap_or(5).max(1);
    repo.get_ocr_pending_files(limit)
        .await
        .map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn upsert_ocr_text(
    fileId: i64,
    lang: String,
    text: String,
    hash: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.upsert_ocr_text(fileId, &lang, &text, &hash)
        .await
        .map_err(|e| e.to_string())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn mark_ocr_failed(
    fileId: i64,
    message: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.mark_ocr_failed(fileId, &message)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_ocr_stats(state: State<'_, AppState>) -> Result<OcrStats, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    repo.get_ocr_stats().await.map_err(|e| e.to_string())
}
