use super::*;
use crate::services::prelude::*;

pub const NOTES_VIEW_DETAILED: &str = "view_notes_detailed";
pub const NOTES_VIEW_COMPACT: &str = "view_notes_compact";
pub const FILE_IMPORT_EVERNOTE: &str = "file_import_evernote";
pub const FILE_IMPORT_OBSIDIAN: &str = "file_import_obsidian";
pub const FILE_IMPORT_HTML: &str = "file_import_html";
pub const FILE_IMPORT_TEXT: &str = "file_import_text";
pub const FILE_IMPORT_NOTES_CLASSIC: &str = "file_import_notes_classic";
pub const FILE_EXPORT_NOTES_CLASSIC: &str = "file_export_notes_classic";
pub const FILE_EXPORT_OBSIDIAN: &str = "file_export_obsidian";
pub const FILE_EXPORT_HTML: &str = "file_export_html";
pub const FILE_EXPORT_TEXT: &str = "file_export_text";
pub const MENU_NEW_NOTE: &str = "menu_new_note";
pub const MENU_NEW_NOTEBOOK: &str = "menu_new_notebook";
pub const MENU_NEW_STACK: &str = "menu_new_stack";
pub const MENU_DELETE_NOTE: &str = "menu_delete_note";
pub const MENU_SEARCH: &str = "menu_search";
pub const MENU_HISTORY: &str = "menu_history";
pub const MENU_SETTINGS: &str = "menu_settings";
pub fn find_check_menu_item<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
) -> Option<CheckMenuItem<R>> {
    for item in items {
        if item.id() == id {
            if let Some(check) = item.as_check_menuitem() {
                return Some(check.clone());
            }
        }
        if let Some(submenu) = item.as_submenu() {
            if let Ok(children) = submenu.items() {
                if let Some(found) = find_check_menu_item(children, id) {
                    return Some(found);
                }
            }
        }
    }
    None
}
pub fn update_notes_list_menu(app_handle: &AppHandle, view: &str) {
    let Some(menu) = app_handle.menu() else {
        return;
    };
    if let Ok(items) = menu.items() {
        if let Some(item) = find_check_menu_item(items, NOTES_VIEW_DETAILED) {
            let _ = item.set_checked(view == "detailed");
        }
    }
    if let Ok(items) = menu.items() {
        if let Some(item) = find_check_menu_item(items, NOTES_VIEW_COMPACT) {
            let _ = item.set_checked(view == "compact");
        }
    }
}
pub fn build_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let resource_dir = resolve_i18n_dir(app_handle);
    let (messages, fallback) = match resolve_portable_paths() {
        Ok((_, settings_dir)) => load_i18n_bundle(&settings_dir, &resource_dir),
        Err(_) => (
            std::collections::HashMap::new(),
            std::collections::HashMap::new(),
        ),
    };
    let label = |key: &str| t(&messages, &fallback, key);
    let import_evernote = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_EVERNOTE,
        label("menu.import_evernote"),
        true,
        None::<&str>,
    )?;
    let import_notes_classic = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_NOTES_CLASSIC,
        label("menu.import_notes_classic"),
        true,
        None::<&str>,
    )?;
    let import_obsidian = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_OBSIDIAN,
        label("menu.import_obsidian"),
        true,
        None::<&str>,
    )?;
    let import_html = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_HTML,
        label("menu.import_html"),
        true,
        None::<&str>,
    )?;
    let import_text = MenuItem::with_id(
        app_handle,
        FILE_IMPORT_TEXT,
        label("menu.import_text"),
        true,
        None::<&str>,
    )?;
    let import_submenu = SubmenuBuilder::new(app_handle, label("menu.import"))
        .item(&import_notes_classic)
        .item(&import_evernote)
        .item(&import_obsidian)
        .item(&import_html)
        .item(&import_text)
        .build()?;
    let export_notes_classic = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_NOTES_CLASSIC,
        label("menu.export_notes_classic"),
        true,
        None::<&str>,
    )?;
    let export_obsidian = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_OBSIDIAN,
        label("menu.export_obsidian"),
        true,
        None::<&str>,
    )?;
    let export_html = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_HTML,
        label("menu.export_html"),
        true,
        None::<&str>,
    )?;
    let export_text = MenuItem::with_id(
        app_handle,
        FILE_EXPORT_TEXT,
        label("menu.export_text"),
        true,
        None::<&str>,
    )?;
    let export_submenu = SubmenuBuilder::new(app_handle, label("menu.export"))
        .item(&export_notes_classic)
        .item(&export_obsidian)
        .item(&export_html)
        .item(&export_text)
        .build()?;

    let file_menu = SubmenuBuilder::new(app_handle, label("menu.file"))
        .item(&import_submenu)
        .item(&export_submenu)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_SETTINGS,
            label("menu.settings"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app_handle, None)?)
        .item(&PredefinedMenuItem::quit(app_handle, None)?)
        .build()?;

    let detailed_item = CheckMenuItem::with_id(
        app_handle,
        NOTES_VIEW_DETAILED,
        label("menu.detailed"),
        true,
        true,
        None::<&str>,
    )?;
    let compact_item = CheckMenuItem::with_id(
        app_handle,
        NOTES_VIEW_COMPACT,
        label("menu.compact"),
        true,
        false,
        None::<&str>,
    )?;
    let notes_list_menu = SubmenuBuilder::new(app_handle, label("menu.notes_list"))
        .item(&detailed_item)
        .item(&compact_item)
        .build()?;

    let view_menu = SubmenuBuilder::new(app_handle, label("menu.view"))
        .item(&notes_list_menu)
        .build()?;

    let note_menu = SubmenuBuilder::new(app_handle, label("menu.note"))
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_NOTE,
            label("menu.new_note"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_NOTEBOOK,
            label("menu.new_notebook"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_NEW_STACK,
            label("menu.new_stack"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_SEARCH,
            label("menu.search"),
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app_handle,
            MENU_HISTORY,
            label("menu.history"),
            true,
            None::<&str>,
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app_handle,
            MENU_DELETE_NOTE,
            label("menu.delete_note"),
            true,
            None::<&str>,
        )?)
        .build()?;

    MenuBuilder::new(app_handle)
        .item(&file_menu)
        .item(&view_menu)
        .item(&note_menu)
        .build()
}
