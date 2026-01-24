use super::*;
use crate::services::prelude::*;

#[tauri::command]
pub fn get_resource_dir(app_handle: AppHandle) -> Result<String, String> {
    let resource_dir = resolve_i18n_dir(&app_handle);
    Ok(resource_dir.to_string_lossy().to_string())
}
#[tauri::command]
pub fn get_i18n_dir(app_handle: AppHandle) -> Result<String, String> {
    let i18n_dir = resolve_i18n_root(&app_handle);
    Ok(i18n_dir.to_string_lossy().to_string())
}
pub fn load_i18n_messages(path: &Path) -> std::collections::HashMap<String, String> {
    let raw = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return std::collections::HashMap::new(),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(val) => val,
        Err(_) => return std::collections::HashMap::new(),
    };
    value
        .as_object()
        .map(|obj| {
            obj.iter()
                .filter_map(|(key, val)| val.as_str().map(|v| (key.to_string(), v.to_string())))
                .collect()
        })
        .unwrap_or_default()
}
pub fn resolve_language(settings_dir: &Path) -> String {
    let value = read_settings_file(settings_dir).unwrap_or(Value::Null);
    let lang = value
        .as_object()
        .and_then(|obj| obj.get("language"))
        .and_then(|v| v.as_str())
        .unwrap_or("en")
        .to_string();
    if lang == "ru" {
        "ru".to_string()
    } else {
        "en".to_string()
    }
}
pub fn load_i18n_bundle(
    settings_dir: &Path,
    resource_dir: &Path,
) -> (
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
) {
    let fallback_path = resource_dir.join("i18n").join("en.json");
    let lang = resolve_language(settings_dir);
    let lang_path = resource_dir.join("i18n").join(format!("{}.json", lang));
    let fallback = load_i18n_messages(&fallback_path);
    let current = if lang == "en" {
        fallback.clone()
    } else {
        load_i18n_messages(&lang_path)
    };
    (current, fallback)
}
pub fn t(
    map: &std::collections::HashMap<String, String>,
    fallback: &std::collections::HashMap<String, String>,
    key: &str,
) -> String {
    if let Some(value) = map.get(key) {
        return value.to_string();
    }
    if let Some(value) = fallback.get(key) {
        return value.to_string();
    }
    key.to_string()
}
pub fn resolve_i18n_dir<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    let root = resolve_i18n_root(app_handle);
    root.parent().map(|p| p.to_path_buf()).unwrap_or_default()
}

fn resolve_i18n_root<R: Runtime>(app_handle: &AppHandle<R>) -> PathBuf {
    let has_i18n = |dir: &Path| dir.join("en.json").exists();
    let resolve_from_dir = |dir: &Path| -> Option<PathBuf> {
        let direct = dir.join("i18n");
        if has_i18n(&direct) {
            return Some(direct);
        }
        let nested = dir.join("resources").join("i18n");
        if has_i18n(&nested) {
            return Some(nested);
        }
        let tauri_resources = dir.join("src-tauri").join("resources").join("i18n");
        if has_i18n(&tauri_resources) {
            return Some(tauri_resources);
        }
        None
    };

    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        bases.push(resource_dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent().map(|p| p.to_path_buf()) {
            bases.push(exe_dir);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        bases.push(cwd);
    }

    for base in bases {
        let mut current = Some(base);
        for _ in 0..8 {
            let Some(dir) = current.take() else { break };
            if let Some(found) = resolve_from_dir(&dir) {
                return found;
            }
            current = dir.parent().map(|p| p.to_path_buf());
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let direct = cwd.join("resources").join("i18n");
        if has_i18n(&direct) {
            return direct;
        }
        let tauri_resources = cwd.join("src-tauri").join("resources").join("i18n");
        if has_i18n(&tauri_resources) {
            return tauri_resources;
        }
    }

    PathBuf::new()
}
