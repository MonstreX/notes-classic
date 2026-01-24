use super::*;
use crate::services::prelude::*;

pub fn strip_html(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ => {
                if !in_tag {
                    output.push(ch);
                }
            }
        }
    }
    output
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn path_to_file_url(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    format!("file:///{}", urlencoding::encode(&raw))
}
pub fn normalize_stack_id(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("Stack:") {
        return Some(raw.trim_start_matches("Stack:").to_string());
    }
    Some(raw.to_string())
}
pub fn value_to_string(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(num) = value.as_i64() {
        return Some(num.to_string());
    }
    if let Some(num) = value.as_u64() {
        return Some(num.to_string());
    }
    None
}
pub fn ext_from_filename(filename: &str) -> Option<String> {
    Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.trim().trim_start_matches('.').to_lowercase())
        .filter(|ext| !ext.is_empty())
}
pub fn ext_from_mime(mime: &str) -> Option<String> {
    mime_guess::get_mime_extensions_str(mime)
        .and_then(|exts| exts.first().copied())
        .map(|ext| ext.to_string())
}
pub fn filename_from_url(url: &str) -> Option<String> {
    let trimmed = url.split('?').next().unwrap_or(url);
    trimmed
        .rsplit('/')
        .next()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}
pub fn percent_decode_lite(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            let hex = |b: u8| -> Option<u8> {
                match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(10 + b - b'a'),
                    b'A'..=b'F' => Some(10 + b - b'A'),
                    _ => None,
                }
            };
            if let (Some(h), Some(l)) = (hex(hi), hex(lo)) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}
pub fn extract_rel_from_asset_url(url: &str) -> Option<String> {
    let lower = url.to_lowercase();
    if lower.starts_with("files/") || lower.starts_with("./files/") {
        return None;
    }
    if let Some(rest) = lower.strip_prefix("notes-file://files/") {
        return Some(rest.to_string());
    }
    let decoded = percent_decode_lite(url).replace('\\', "/");
    if let Some(idx) = decoded.to_lowercase().find("/files/") {
        return Some(
            decoded[idx + "/files/".len()..]
                .trim_start_matches('/')
                .to_string(),
        );
    }
    if let Some(idx) = lower.find("%2ffiles%2f") {
        let rel = &url[idx + "%2ffiles%2f".len()..];
        let decoded_rel = percent_decode_lite(rel);
        return Some(decoded_rel.trim_start_matches('/').replace('\\', "/"));
    }
    None
}
#[tauri::command]
pub fn create_evernote_backup(state: State<'_, AppState>) -> Result<String, String> {
    let timestamp = chrono::Local::now()
        .format("evernote-%Y%m%d-%H%M%S")
        .to_string();
    let backup_dir = state.data_dir.join("backups").join(timestamp);
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let notes_db = state.data_dir.join("notes.db");
    if notes_db.exists() {
        fs::copy(&notes_db, backup_dir.join("notes.db")).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&state.data_dir.join("files"), &backup_dir.join("files"))?;
    copy_dir_recursive(&state.data_dir.join("ocr"), &backup_dir.join("ocr"))?;
    Ok(backup_dir.to_string_lossy().to_string())
}
pub fn updated_at_ts(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_secs() as i64)
        .unwrap_or(0)
}
#[allow(non_snake_case)]
#[tauri::command]
pub fn find_evernote_paths(basePath: String) -> Result<EvernotePaths, String> {
    let base = PathBuf::from(basePath);
    if !base.exists() {
        return Err("Base path not found".to_string());
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(base.clone(), 0)];
    let mut db_candidate: Option<(PathBuf, i64)> = None;
    let mut rte_candidate: Option<(PathBuf, i64)> = None;
    let mut resources_candidate: Option<(PathBuf, i64)> = None;

    const MAX_DEPTH: usize = 6;
    const MAX_ENTRIES: usize = 20000;
    let mut visited = 0usize;

    while let Some((path, depth)) = stack.pop() {
        if visited > MAX_ENTRIES {
            break;
        }
        visited += 1;
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries {
            let entry = match entry {
                Ok(value) => value,
                Err(_) => continue,
            };
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if entry_path.is_file() && name.to_lowercase().ends_with("remotegraph.sql") {
                let ts = updated_at_ts(&entry_path);
                if db_candidate
                    .as_ref()
                    .map(|(_, best)| ts > *best)
                    .unwrap_or(true)
                {
                    db_candidate = Some((entry_path.clone(), ts));
                }
                continue;
            }
            if entry_path.is_dir() {
                if name.eq_ignore_ascii_case("internal_rteDoc") {
                    let ts = updated_at_ts(&entry_path);
                    if rte_candidate
                        .as_ref()
                        .map(|(_, best)| ts > *best)
                        .unwrap_or(true)
                    {
                        rte_candidate = Some((entry_path.clone(), ts));
                    }
                } else if name.eq_ignore_ascii_case("resource-cache") {
                    let ts = updated_at_ts(&entry_path);
                    if resources_candidate
                        .as_ref()
                        .map(|(_, best)| ts > *best)
                        .unwrap_or(true)
                    {
                        resources_candidate = Some((entry_path.clone(), ts));
                    }
                }
                if depth < MAX_DEPTH {
                    stack.push((entry_path, depth + 1));
                }
            }
        }
    }

    Ok(EvernotePaths {
        db_path: db_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
        rte_root: rte_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
        resources_root: resources_candidate.map(|(path, _)| path.to_string_lossy().to_string()),
    })
}
