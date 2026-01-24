use super::*;
use crate::services::prelude::*;

pub struct AppState {
    pub pool: sqlx::sqlite::SqlitePool,
    pub settings_dir: PathBuf,
    pub data_dir: PathBuf,
}
#[cfg(debug_assertions)]
#[tauri::command]
pub fn restart_app(app_handle: AppHandle) -> Result<(), String> {
    std::thread::sleep(std::time::Duration::from_secs(2));
    app_handle.restart();
}
#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn restart_app(app_handle: AppHandle) -> Result<(), String> {
    std::thread::sleep(std::time::Duration::from_secs(2));
    if let Ok(exe) = std::env::current_exe() {
        if std::process::Command::new(exe).spawn().is_ok() {
            app_handle.exit(0);
            return Ok(());
        }
    }
    app_handle.restart();
}
#[tauri::command]
pub fn exit_app(app_handle: AppHandle) -> Result<(), String> {
    app_handle.exit(0);
    Ok(())
}
pub fn resolve_portable_paths() -> Result<(PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "Failed to resolve executable directory".to_string())?;
    let mut data_dir = exe_dir.join("data");
    let mut settings_dir = exe_dir.join("settings");

    if let Ok(appimage_path) = std::env::var("APPIMAGE") {
        let base = PathBuf::from(appimage_path);
        data_dir = PathBuf::from(format!("{}.data", base.to_string_lossy()));
        settings_dir = PathBuf::from(format!("{}.settings", base.to_string_lossy()));
    }

    if let Ok(cwd) = std::env::current_dir() {
        let mut candidates = Vec::new();
        candidates.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
        if let Some(grand) = cwd.parent().and_then(|p| p.parent()) {
            candidates.push(grand.to_path_buf());
        }
        for base in candidates {
            let is_dev_root = base.join("package.json").exists() && base.join("src-tauri").exists();
            if is_dev_root {
                data_dir = base.join("data");
                settings_dir = base.join("settings");
                break;
            }
        }
    }
    ensure_dir_writable(&settings_dir)?;
    if let Ok(Some(override_dir)) = read_storage_override(&settings_dir) {
        data_dir = override_dir;
    }
    ensure_dir_writable(&data_dir)?;

    Ok((data_dir, settings_dir))
}
