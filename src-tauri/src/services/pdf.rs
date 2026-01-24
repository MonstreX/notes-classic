use super::*;
use crate::services::prelude::*;

pub fn rewrite_pdf_asset_sources(content: &str, data_dir: &Path) -> String {
    let re = match Regex::new(r#"src=(["'])([^"']+)["']"#) {
        Ok(value) => value,
        Err(_) => return content.to_string(),
    };
    re.replace_all(content, |caps: &regex::Captures| {
        let original = &caps[2];
        let updated = if original.starts_with("http://asset.localhost/") {
            let encoded = original.trim_start_matches("http://asset.localhost/");
            urlencoding::decode(encoded)
                .ok()
                .map(|value| path_to_file_url(&PathBuf::from(value.into_owned())))
                .unwrap_or_else(|| original.to_string())
        } else if original.starts_with("notes-file://files/") {
            let rel = original.trim_start_matches("notes-file://files/");
            path_to_file_url(&data_dir.join("files").join(rel))
        } else if original.starts_with("files/") {
            let rel = original.trim_start_matches("files/");
            path_to_file_url(&data_dir.join("files").join(rel))
        } else {
            original.to_string()
        };
        format!("src=\"{}\"", updated)
    })
    .to_string()
}
pub fn resolve_wkhtmltopdf_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let data_dir = app_handle.state::<AppState>().data_dir.clone();
    #[cfg(target_os = "windows")]
    {
        candidates.push(
            data_dir
                .join("resources")
                .join("pdf")
                .join("win")
                .join("wkhtmltopdf.exe"),
        );
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(
            data_dir
                .join("resources")
                .join("pdf")
                .join("linux")
                .join("wkhtmltopdf"),
        );
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(
            data_dir
                .join("resources")
                .join("pdf")
                .join("mac")
                .join("wkhtmltopdf"),
        );
    }
    let resource_dir = app_handle.path().resource_dir().ok();
    #[cfg(target_os = "windows")]
    {
        if let Some(dir) = resource_dir.as_ref() {
            candidates.push(dir.join("pdf").join("win").join("wkhtmltopdf.exe"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(dir) = resource_dir.as_ref() {
            candidates.push(dir.join("pdf").join("linux").join("wkhtmltopdf"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(dir) = resource_dir.as_ref() {
            candidates.push(dir.join("pdf").join("mac").join("wkhtmltopdf"));
            let pkg = dir.join("pdf").join("mac").join("wkhtmltopdf.pkg");
            if pkg.exists() {
                return Err("wkhtmltopdf.pkg is present but not extracted".to_string());
            }
        }
    }
    if let Ok(current) = std::env::current_dir() {
        #[cfg(target_os = "windows")]
        {
            candidates.push(
                current
                    .join("src-tauri")
                    .join("resources")
                    .join("pdf")
                    .join("win")
                    .join("wkhtmltopdf.exe"),
            );
            candidates.push(
                current
                    .join("resources")
                    .join("pdf")
                    .join("win")
                    .join("wkhtmltopdf.exe"),
            );
        }
        #[cfg(target_os = "linux")]
        {
            candidates.push(
                current
                    .join("src-tauri")
                    .join("resources")
                    .join("pdf")
                    .join("linux")
                    .join("wkhtmltopdf"),
            );
            candidates.push(
                current
                    .join("resources")
                    .join("pdf")
                    .join("linux")
                    .join("wkhtmltopdf"),
            );
        }
        #[cfg(target_os = "macos")]
        {
            candidates.push(
                current
                    .join("src-tauri")
                    .join("resources")
                    .join("pdf")
                    .join("mac")
                    .join("wkhtmltopdf"),
            );
            candidates.push(
                current
                    .join("resources")
                    .join("pdf")
                    .join("mac")
                    .join("wkhtmltopdf"),
            );
        }
    }
    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }
    Err("wkhtmltopdf binary not found".to_string())
}
#[derive(serde::Serialize)]
pub struct PdfResourceStatus {
    available: bool,
    missing: Vec<String>,
}
#[tauri::command]
pub fn get_pdf_resource_status(app_handle: AppHandle) -> Result<PdfResourceStatus, String> {
    let mut missing = Vec::new();
    let data_dir = app_handle.state::<AppState>().data_dir.clone();
    #[cfg(target_os = "windows")]
    {
        let base = data_dir.join("resources").join("pdf").join("win");
        let exe_exists = base.join("wkhtmltopdf.exe").exists()
            || base.join("bin").join("wkhtmltopdf.exe").exists();
        let dll_exists =
            base.join("wkhtmltox.dll").exists() || base.join("bin").join("wkhtmltox.dll").exists();
        if !exe_exists {
            missing.push("wkhtmltopdf.exe".to_string());
        }
        if !dll_exists {
            missing.push("wkhtmltox.dll".to_string());
        }
    }
    #[cfg(target_os = "linux")]
    {
        let base = data_dir.join("resources").join("pdf").join("linux");
        if !base.join("wkhtmltopdf").exists() && !base.join("bin").join("wkhtmltopdf").exists() {
            missing.push("wkhtmltopdf".to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        let base = data_dir.join("resources").join("pdf").join("mac");
        if !base.join("wkhtmltopdf").exists() && !base.join("bin").join("wkhtmltopdf").exists() {
            missing.push("wkhtmltopdf".to_string());
        }
    }
    Ok(PdfResourceStatus {
        available: missing.is_empty(),
        missing,
    })
}
#[cfg(target_os = "windows")]
pub async fn extract_zip_to_dir(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        let lower = name.to_lowercase();
        if !lower.ends_with("wkhtmltopdf.exe") && !lower.ends_with("wkhtmltox.dll") {
            continue;
        }
        let filename = Path::new(&name)
            .file_name()
            .ok_or("invalid zip entry")?
            .to_string_lossy()
            .to_string();
        let out_path = dest.join(filename);
        let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub async fn extract_tar_xz_to_dir(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let decompressor = XzDecoder::new(file);
    let mut archive = Archive::new(decompressor);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let path_str = path.to_string_lossy().replace('\\', "/");
        let lower = path_str.to_lowercase();
        if !(lower.ends_with("/wkhtmltopdf") || lower.contains("libwkhtmltox")) {
            continue;
        }
        let filename = path
            .file_name()
            .ok_or("invalid archive entry")?
            .to_string_lossy()
            .to_string();
        let out_path = dest.join(filename);
        let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn download_pdf_resources(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let temp_dir = state.data_dir.join("resources").join("tmp");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let (urls, dest_dir) = {
        let dir = state.data_dir.join("resources").join("pdf").join("win");
        (vec![
            "https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox-0.12.6-1.msvc2015-win64.exe",
        ], dir)
    };
    #[cfg(target_os = "linux")]
    let (urls, dest_dir) = {
        let dir = state.data_dir.join("resources").join("pdf").join("linux");
        (vec![
            "https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox-0.12.6-1.linux-generic-amd64.tar.xz",
        ], dir)
    };
    #[cfg(target_os = "macos")]
    let (urls, dest_dir) = {
        let dir = state.data_dir.join("resources").join("pdf").join("mac");
        (vec![
            "https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox-0.12.6-1.macos-cocoa-x86_64.tar.xz",
        ], dir)
    };

    let mut last_error: Option<String> = None;
    let mut archive_path = temp_dir.join("wkhtmltopdf-download");
    let mut chosen_url: Option<String> = None;
    for (idx, url) in urls.iter().enumerate() {
        let total = content_length(&client, url).await.unwrap_or(0);
        let mut current = 0;
        let path = temp_dir.join(format!("wkhtmltopdf-download-{}", idx));
        match download_with_progress(
            &client,
            &app_handle,
            "pdf",
            url,
            &path,
            (idx as u32) + 1,
            urls.len() as u32,
            &mut current,
            total,
        )
        .await
        {
            Ok(_) => {
                archive_path = path;
                chosen_url = Some(url.to_string());
                last_error = None;
                break;
            }
            Err(err) => {
                last_error = Some(format!("{} {}", url, err));
            }
        }
    }
    if chosen_url.is_none() {
        return Err(last_error.unwrap_or_else(|| "download failed".to_string()));
    }
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let url = chosen_url.as_ref().unwrap();
        if url.ends_with(".exe") {
            let dest = dest_dir.clone();
            let installer = archive_path.clone();
            let status = tokio::task::spawn_blocking(move || {
                std::process::Command::new(installer)
                    .arg("/S")
                    .arg(format!("/D={}", dest.display()))
                    .status()
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())??;
            if !status.success() {
                return Err("installer failed".to_string());
            }
        } else {
            extract_zip_to_dir(&archive_path, &dest_dir).await?;
        }
        if dest_dir.join("bin").join("wkhtmltopdf.exe").exists() {
            let bin = dest_dir.join("bin").join("wkhtmltopdf.exe");
            let target = dest_dir.join("wkhtmltopdf.exe");
            if !target.exists() {
                let _ = std::fs::copy(bin, target);
            }
        }
        if dest_dir.join("bin").join("wkhtmltox.dll").exists() {
            let bin = dest_dir.join("bin").join("wkhtmltox.dll");
            let target = dest_dir.join("wkhtmltox.dll");
            if !target.exists() {
                let _ = std::fs::copy(bin, target);
            }
        }
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        extract_tar_xz_to_dir(&archive_path, &dest_dir).await?;
        let bin_path = dest_dir.join("wkhtmltopdf");
        if bin_path.exists() {
            let mut perms = std::fs::metadata(&bin_path)
                .map_err(|e| e.to_string())?
                .permissions();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                perms.set_mode(0o755);
                std::fs::set_permissions(&bin_path, perms).map_err(|e| e.to_string())?;
            }
        }
    }
    let _ = tokio::fs::remove_file(&archive_path).await;
    Ok(())
}
#[allow(non_snake_case)]
#[tauri::command]
pub async fn export_note_pdf_native(
    noteId: i64,
    destPath: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repo = SqliteRepository {
        pool: state.pool.clone(),
    };
    let note = repo
        .get_note(noteId)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Note not found".to_string())?;
    let mut dest = PathBuf::from(destPath.trim());
    if dest.as_os_str().is_empty() {
        return Err("Destination path is empty".to_string());
    }
    if !dest
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
    {
        dest.set_extension("pdf");
    }
    let title = note.title.trim();
    let title = if title.is_empty() { "Untitled" } else { title };
    let rewritten = rewrite_pdf_asset_sources(&note.content, &state.data_dir);
    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><style>body{{font-family:Arial,sans-serif;margin:0;padding:0;background:#fff;color:#111;}} .pdf-note{{padding:24px 28px;}} .pdf-note h1{{font-size:22px;font-weight:500;margin:0 0 16px;}} .note-content img{{max-width:100%;height:auto;}}</style></head><body><article class=\"pdf-note\"><h1>{}</h1><div class=\"note-content\">{}</div></article></body></html>",
        title,
        rewritten
    );

    let temp_dir = state.data_dir.join("pdf-export");
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }
    let temp_file = temp_dir.join(format!("note-{}.html", noteId));
    fs::write(&temp_file, html).map_err(|e| e.to_string())?;
    let tool = resolve_wkhtmltopdf_path(&app_handle)?;
    let tool_dir = tool
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let mut command = std::process::Command::new(tool);
    command.current_dir(&tool_dir);
    #[cfg(target_os = "windows")]
    {
        if let Ok(path) = std::env::var("PATH") {
            let joined = format!("{};{}", tool_dir.to_string_lossy(), path);
            command.env("PATH", joined);
        } else {
            command.env("PATH", tool_dir.to_string_lossy().to_string());
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(path) = std::env::var("LD_LIBRARY_PATH") {
            let joined = format!("{}:{}", tool_dir.to_string_lossy(), path);
            command.env("LD_LIBRARY_PATH", joined);
        } else {
            command.env("LD_LIBRARY_PATH", tool_dir.to_string_lossy().to_string());
        }
    }
    let status = command
        .arg("--enable-local-file-access")
        .arg("--encoding")
        .arg("utf-8")
        .arg("--page-size")
        .arg("A4")
        .arg("--margin-top")
        .arg("15mm")
        .arg("--margin-bottom")
        .arg("15mm")
        .arg("--margin-left")
        .arg("15mm")
        .arg("--margin-right")
        .arg("15mm")
        .arg(temp_file.to_string_lossy().to_string())
        .arg(dest.to_string_lossy().to_string())
        .status()
        .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&temp_file);
    if !status.success() {
        return Err("wkhtmltopdf failed".to_string());
    }
    Ok(())
}
