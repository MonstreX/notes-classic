use super::*;
use crate::services::prelude::*;

pub static NOTE_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
pub fn store_note_bytes(
    data_dir: &Path,
    filename: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<StoredNoteFile, String> {
    if bytes.is_empty() {
        return Err("Empty file bytes".to_string());
    }
    if bytes.len() > MAX_NOTE_FILE_BYTES {
        return Err("File exceeds maximum size".to_string());
    }
    let filename_ext = ext_from_filename(filename);
    let mime_ext = ext_from_mime(mime);
    let resolved_ext = if mime.starts_with("image/") {
        mime_ext.clone().or(filename_ext.clone())
    } else {
        filename_ext.clone().or(mime_ext.clone())
    }
    .unwrap_or_else(|| "bin".to_string());
    let resolved_mime = if !mime.is_empty() {
        mime.to_string()
    } else {
        mime_guess::from_ext(&resolved_ext)
            .first_or_octet_stream()
            .to_string()
    };

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let content_hash = format!("{:x}", hasher.finalize());
    let nonce = NOTE_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let mut name_hasher = Sha256::new();
    name_hasher.update(bytes);
    name_hasher.update(nanos.to_string().as_bytes());
    name_hasher.update(nonce.to_string().as_bytes());
    let unique_hash = format!("{:x}", name_hasher.finalize());
    let rel_dir = PathBuf::from("files").join(&unique_hash[0..2]);
    let rel_file = format!("{}.{}", unique_hash, resolved_ext);
    let rel_path = rel_dir.join(&rel_file);
    let full_dir = data_dir.join(&rel_dir);
    fs::create_dir_all(&full_dir).map_err(|e| e.to_string())?;
    let full_path = data_dir.join(&rel_path);
    fs::write(&full_path, bytes).map_err(|e| e.to_string())?;
    let rel_display = PathBuf::from(&unique_hash[0..2]).join(rel_file);
    Ok(StoredNoteFile {
        rel_path: rel_display.to_string_lossy().replace('\\', "/"),
        hash: content_hash,
        mime: resolved_mime,
    })
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    path: String,
    rel_path: String,
}
pub fn notes_file_response(data_dir: &Path, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri: &Uri = request.uri();
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
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    let full_path = data_dir.join(rel);
    if !full_path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }
    let bytes = match fs::read(&full_path) {
        Ok(data) => data,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()))
        }
    };
    let mime = match full_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
    {
        Some(ext) if ext == "png" => "image/png",
        Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
        Some(ext) if ext == "jfif" => "image/jpeg",
        Some(ext) if ext == "gif" => "image/gif",
        Some(ext) if ext == "webp" => "image/webp",
        Some(ext) if ext == "svg" => "image/svg+xml",
        Some(ext) if ext == "pdf" => "application/pdf",
        Some(ext) if ext == "txt" => "text/plain",
        _ => "application/octet-stream",
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}
#[tauri::command]
pub async fn store_note_file_bytes(
    filename: String,
    mime: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
    store_note_bytes(&state.data_dir, &filename, &mime, &bytes)
}
#[tauri::command]
pub async fn download_note_file(
    url: String,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    let headers = response.headers().clone();
    if let Some(length) = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
    {
        if length > MAX_NOTE_FILE_BYTES {
            return Err("File exceeds maximum size".to_string());
        }
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_NOTE_FILE_BYTES {
        return Err("File exceeds maximum size".to_string());
    }
    let mime = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let filename = filename_from_url(&url).unwrap_or_else(|| "download".to_string());
    store_note_bytes(&state.data_dir, &filename, mime, &bytes)
}
#[tauri::command]
pub async fn store_note_file_from_path(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<StoredNoteFile, String> {
    let path = PathBuf::from(&source_path);
    if !path.exists() {
        return Err("Source file not found".to_string());
    }
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();
    let mime = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    store_note_bytes(&state.data_dir, &filename, &mime, &bytes)
}
#[tauri::command]
pub async fn delete_attachment(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let path = repo
        .delete_attachment(id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(rel) = path {
        let full_path = state.data_dir.join(rel);
        if full_path.exists() {
            let _ = fs::remove_file(&full_path);
        }
        if let Some(parent) = full_path.parent() {
            let _ = fs::remove_dir(parent);
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn save_attachment_as(
    id: i64,
    dest_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    fs::copy(&source, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn read_attachment_text(
    id: i64,
    max_bytes: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    let file = fs::File::open(&source).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    let limit = max_bytes.max(0) as usize;
    file.take(limit as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}
#[tauri::command]
pub async fn read_attachment_bytes(id: i64, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let attachment = repo.get_attachment(id).await.map_err(|e| e.to_string())?;
    let Some(att) = attachment else {
        return Err("Attachment not found".to_string());
    };
    if att.local_path.is_empty() {
        return Err("Attachment file missing".to_string());
    }
    let source = state.data_dir.join(att.local_path);
    fs::read(&source).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn save_bytes_as(dest_path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(dest_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    let path = PathBuf::from(path);
    Ok(path.exists())
}
#[tauri::command]
pub fn list_files_recursive(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut stack = vec![root_path.clone()];
    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if name == ".obsidian" {
                    continue;
                }
                if name.starts_with('.') {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if name.starts_with('.') {
                continue;
            }
            let rel_path = path
                .strip_prefix(&root_path)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            entries.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                rel_path,
            });
        }
    }
    Ok(entries)
}
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    fs::read(&path).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_attachment_by_path(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<Attachment>, String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let normalized = path.replace('\\', "/");
    let normalized = if normalized.starts_with("files/") {
        normalized
    } else {
        format!("files/{}", normalized.trim_start_matches('/'))
    };
    repo.get_attachment_by_path(&normalized)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn path_is_dir(path: String) -> Result<bool, String> {
    let path = PathBuf::from(path);
    Ok(path.is_dir())
}
#[tauri::command]
pub fn copy_file(source: String, dest: String) -> Result<(), String> {
    let source = PathBuf::from(source);
    let dest = PathBuf::from(dest);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn get_dir_size(path: String) -> Result<u64, String> {
    fn dir_size(path: &Path) -> Result<u64, String> {
        if !path.exists() {
            return Ok(0);
        }
        let mut total = 0u64;
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            if meta.is_dir() {
                total += dir_size(&entry.path())?;
            } else {
                total += meta.len();
            }
        }
        Ok(total)
    }
    dir_size(&PathBuf::from(path))
}
#[tauri::command]
pub fn resolve_resource_roots(path: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut roots = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_dir() && name.to_lowercase().starts_with("user") {
            roots.push(entry.path().to_string_lossy().to_string());
        }
    }
    if roots.is_empty() {
        roots.push(root.to_string_lossy().to_string());
    }
    Ok(roots)
}
#[tauri::command]
pub fn count_missing_rte(rte_root: String, note_ids: Vec<String>) -> Result<i64, String> {
    let root = PathBuf::from(rte_root);
    let mut missing = 0i64;
    for note_id in note_ids {
        if note_id.len() < 6 {
            missing += 1;
            continue;
        }
        let sub_a = &note_id[0..3];
        let sub_b = &note_id[note_id.len() - 3..];
        let path = root
            .join(sub_a)
            .join(sub_b)
            .join(format!("{}.dat", note_id));
        if !path.exists() {
            missing += 1;
        }
    }
    Ok(missing)
}
#[tauri::command]
pub fn set_notes_list_view(view: String, app_handle: AppHandle) -> Result<(), String> {
    update_notes_list_menu(&app_handle, &view);
    Ok(())
}
