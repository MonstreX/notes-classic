#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod services;

use db::SqliteRepository;
use services::*;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("notes-file", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            notes_file_response(&state.data_dir, request)
        })
        .setup(|app| {
            let app_handle = app.handle();
            let (data_dir, settings_dir) = match resolve_portable_paths() {
                Ok(paths) => paths,
                Err(err) => {
                    app_handle
                        .dialog()
                        .message(err.clone())
                        .title("Storage Error")
                        .show(|_| {});
                    return Err(err.into());
                }
            };
            let pool = tauri::async_runtime::block_on(async { db::init_db(&data_dir).await });
            let pool = match pool {
                Ok(pool) => pool,
                Err(err) => {
                    app_handle
                        .dialog()
                        .message(err.clone())
                        .title("Storage Error")
                        .show(|_| {});
                    return Err(err.into());
                }
            };
            app.manage(AppState {
                pool,
                settings_dir,
                data_dir,
            });
            let menu = build_menu(app_handle)?;
            app.set_menu(menu)?;
            let pool = app.state::<AppState>().pool.clone();
            let data_dir = app.state::<AppState>().data_dir.clone();
            tauri::async_runtime::spawn(async move {
                let repo = SqliteRepository { pool };
                match repo.needs_note_files_backfill().await {
                    Ok(true) => {
                        let _ = repo.backfill_note_files_and_ocr(&data_dir).await;
                    }
                    Ok(false) => {}
                    Err(_) => {}
                }
            });
            Ok(())
        })
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app_handle, event| match event.id().0.as_str() {
            FILE_IMPORT_EVERNOTE => {
                let _ = app_handle.emit("import-evernote", ());
            }
            FILE_IMPORT_NOTES_CLASSIC => {
                let _ = app_handle.emit("import-notes-classic", ());
            }
            FILE_IMPORT_OBSIDIAN => {
                let _ = app_handle.emit("import-obsidian", ());
            }
            FILE_IMPORT_HTML => {
                let _ = app_handle.emit("import-html", ());
            }
            FILE_IMPORT_TEXT => {
                let _ = app_handle.emit("import-text", ());
            }
            FILE_EXPORT_NOTES_CLASSIC => {
                let _ = app_handle.emit("export-notes-classic", ());
            }
            FILE_EXPORT_OBSIDIAN => {
                let _ = app_handle.emit("export-obsidian", ());
            }
            FILE_EXPORT_HTML => {
                let _ = app_handle.emit("export-html", ());
            }
            FILE_EXPORT_TEXT => {
                let _ = app_handle.emit("export-text", ());
            }
            MENU_NEW_NOTE => {
                let _ = app_handle.emit("menu-new-note", ());
            }
            MENU_NEW_NOTEBOOK => {
                let _ = app_handle.emit("menu-new-notebook", ());
            }
            MENU_NEW_STACK => {
                let _ = app_handle.emit("menu-new-stack", ());
            }
            MENU_DELETE_NOTE => {
                let _ = app_handle.emit("menu-delete-note", ());
            }
            MENU_SEARCH => {
                let _ = app_handle.emit("menu-search", ());
            }
            MENU_HISTORY => {
                let _ = app_handle.emit("menu-history", ());
            }
            MENU_SETTINGS => {
                let _ = app_handle.emit("menu-settings", ());
            }
            NOTES_VIEW_DETAILED => {
                update_notes_list_menu(app_handle, "detailed");
                let _ = app_handle.emit("notes-list-view", "detailed");
            }
            NOTES_VIEW_COMPACT => {
                update_notes_list_menu(app_handle, "compact");
                let _ = app_handle.emit("notes-list-view", "compact");
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_notebooks,
            create_notebook,
            rename_notebook,
            delete_notebook,
            move_notebook,
            move_note,
            get_notes,
            get_notes_by_tag,
            get_trashed_notes,
            search_notes,
            search_notes_by_title,
            get_note,
            get_note_id_by_external_id,
            set_note_external_id,
            get_note_counts,
            get_data_dir,
            upsert_note,
            delete_note,
            trash_note,
            restore_note,
            restore_all_notes,
            delete_all_trashed_notes,
            import_attachment,
            import_attachment_bytes,
            store_note_file_bytes,
            download_note_file,
            store_note_file_from_path,
            delete_attachment,
            save_attachment_as,
            read_attachment_text,
            read_attachment_bytes,
            get_attachment_by_path,
            save_bytes_as,
            add_history_entry,
            get_note_history,
            clear_note_history,
            cleanup_note_history,
            path_exists,
            list_files_recursive,
            path_is_dir,
            ensure_dir,
            read_file_bytes,
            copy_file,
            get_dir_size,
            resolve_resource_roots,
            count_missing_rte,
            get_resource_dir,
            get_i18n_dir,
            create_evernote_backup,
            create_import_backup,
            restore_import_backup,
            find_evernote_paths,
            select_evernote_folder,
            select_notes_classic_folder,
            select_obsidian_folder,
            select_html_folder,
            select_text_folder,
            select_export_folder,
            export_notes_classic,
            import_notes_classic_from_manifest,
            import_evernote_from_json,
            run_note_files_backfill,
            get_ocr_pending_files,
            upsert_ocr_text,
            mark_ocr_failed,
            get_ocr_stats,
            download_ocr_resources,
            get_pdf_resource_status,
            download_pdf_resources,
            export_note_pdf_native,
            get_tags,
            get_note_tags,
            create_tag,
            add_note_tag,
            remove_note_tag,
            delete_tag,
            update_tag_parent,
            rename_tag,
            set_notes_list_view,
            get_settings,
            set_settings,
            get_default_storage_path,
            get_storage_override,
            get_storage_info,
            clear_storage_for_import,
            restart_app,
            exit_app,
            set_storage_path,
            set_storage_default,
            set_storage_default_existing,
            set_storage_default_replace,
            set_storage_default_empty,
            set_storage_path_existing,
            set_storage_path_replace,
            set_storage_path_empty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
