use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

fn strip_html(input: &str) -> String {
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

fn extract_note_files(content: &str) -> Vec<String> {
    let mut results = Vec::new();
    let re_notes_double = Regex::new(r#"src="notes-file://files/(?:evernote/)?([^"]+)""#).unwrap();
    for caps in re_notes_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_notes_single = Regex::new(r#"src='notes-file://files/(?:evernote/)?([^']+)'"#).unwrap();
    for caps in re_notes_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_plain_double = Regex::new(r#"src="files/(?:evernote/)?([^"]+)""#).unwrap();
    for caps in re_plain_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_plain_single = Regex::new(r#"src='files/(?:evernote/)?([^']+)'"#).unwrap();
    for caps in re_plain_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_double = Regex::new(r#"src="[^"]*asset\.localhost[^"]*files/([^"]+)""#).unwrap();
    for caps in re_asset_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_single = Regex::new(r#"src='[^']*asset\.localhost[^']*files/([^']+)'"#).unwrap();
    for caps in re_asset_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            results.push(path.as_str().to_string());
        }
    }
    let re_asset_encoded_double =
        Regex::new(r#"src="[^"]*asset\.localhost[^"]*(?i:files%2F)([^"]+)""#).unwrap();
    for caps in re_asset_encoded_double.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            let candidate = format!("files/{}", path.as_str());
            if let Ok(decoded) = urlencoding::decode(&candidate) {
                results.push(decoded.to_string().trim_start_matches("files/").to_string());
            }
        }
    }
    let re_asset_encoded_single =
        Regex::new(r#"src='[^']*asset\.localhost[^']*(?i:files%2F)([^']+)'"#).unwrap();
    for caps in re_asset_encoded_single.captures_iter(content) {
        if let Some(path) = caps.get(1) {
            let candidate = format!("files/{}", path.as_str());
            if let Ok(decoded) = urlencoding::decode(&candidate) {
                results.push(decoded.to_string().trim_start_matches("files/").to_string());
            }
        }
    }
    results.sort();
    results.dedup();
    results
}

const OCR_IMAGE_FILTER: &str = "(
    lower(f.file_path) LIKE '%.png' OR
    lower(f.file_path) LIKE '%.jpg' OR
    lower(f.file_path) LIKE '%.jpeg' OR
    lower(f.file_path) LIKE '%.gif' OR
    lower(f.file_path) LIKE '%.webp' OR
    lower(f.file_path) LIKE '%.bmp' OR
    lower(f.file_path) LIKE '%.jfif' OR
    lower(f.file_path) LIKE '%.tif' OR
    lower(f.file_path) LIKE '%.tiff' OR
    lower(a.mime) LIKE 'image/%'
)";

async fn migrate_note_file_scheme(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let rows: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, content FROM notes WHERE content LIKE '%notes-file://files/%'")
            .fetch_all(pool)
            .await?;
    if rows.is_empty() {
        return Ok(false);
    }
    for (id, content) in rows {
        let updated = content.replace("notes-file://files/", "files/");
        sqlx::query("UPDATE notes SET content = ? WHERE id = ?")
            .bind(&updated)
            .bind(id)
            .execute(pool)
            .await?;
        let plain = strip_html(&updated);
        sqlx::query(
            "INSERT INTO notes_text (note_id, title, plain_text)
             SELECT id, title, ? FROM notes WHERE id = ?
             ON CONFLICT(note_id) DO UPDATE SET plain_text = excluded.plain_text",
        )
        .bind(plain)
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(true)
}

fn extract_attachment_ids(content: &str) -> HashSet<i64> {
    let mut results = HashSet::new();
    let re_double = Regex::new(r#"data-attachment-id="(\d+)""#).unwrap();
    for caps in re_double.captures_iter(content) {
        if let Some(value) = caps.get(1) {
            if let Ok(id) = value.as_str().parse::<i64>() {
                results.insert(id);
            }
        }
    }
    let re_single = Regex::new(r#"data-attachment-id='(\d+)'"#).unwrap();
    for caps in re_single.captures_iter(content) {
        if let Some(value) = caps.get(1) {
            if let Ok(id) = value.as_str().parse::<i64>() {
                results.insert(id);
            }
        }
    }
    results
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub parent_id: Option<i64>,
    pub notebook_type: String,
    pub sort_order: i64,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sync_status: i32,
    pub remote_id: Option<String>,
    pub notebook_id: Option<i64>,
    pub external_id: Option<String>,
    pub meta: Option<String>,
    pub content_hash: Option<String>,
    pub content_size: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub updated_at: i64,
    pub notebook_id: Option<i64>,
    pub ocr_match: bool,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkItem {
    pub id: i64,
    pub title: String,
    pub notebook_id: Option<i64>,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i64,
    pub note_id: i64,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub local_path: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrFileItem {
    pub file_id: i64,
    pub file_path: String,
    pub mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrStats {
    pub total: i64,
    pub done: i64,
    pub pending: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteCountItem {
    pub notebook_id: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteCounts {
    pub total: i64,
    pub trashed: i64,
    pub per_notebook: Vec<NoteCountItem>,
}

const SCHEMA_VERSION: i64 = 5;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryItem {
    pub id: i64,
    pub note_id: i64,
    pub opened_at: i64,
    pub note_title: String,
    pub notebook_id: Option<i64>,
    pub notebook_name: Option<String>,
    pub stack_id: Option<i64>,
    pub stack_name: Option<String>,
}

async fn table_exists(pool: &SqlitePool, name: &str) -> Result<bool, sqlx::Error> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, sqlx::Error> {
    let table = table.replace('\'', "''");
    let query = format!(
        "SELECT name FROM pragma_table_info('{}') WHERE name = ?",
        table
    );
    let row: Option<(String,)> = sqlx::query_as(&query)
        .bind(column)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

async fn ensure_schema_version(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        .execute(pool)
        .await?;
    let existing: Option<(i64,)> = sqlx::query_as("SELECT version FROM schema_version LIMIT 1")
        .fetch_optional(pool)
        .await?;
    if let Some((version,)) = existing {
        return Ok(version);
    }
    let has_notes = table_exists(pool, "notes").await?;
    let initial = if has_notes { 1 } else { 0 };
    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(initial)
        .execute(pool)
        .await?;
    Ok(initial)
}

async fn set_schema_version(pool: &SqlitePool, version: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE schema_version SET version = ?")
        .bind(version)
        .execute(pool)
        .await?;
    Ok(())
}

async fn create_schema_v3(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            parent_id INTEGER,
            notebook_type TEXT NOT NULL DEFAULT 'stack',
            sort_order INTEGER NOT NULL DEFAULT 0,
            external_id TEXT,
            FOREIGN KEY(parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sync_status INTEGER DEFAULT 0,
            remote_id TEXT,
            notebook_id INTEGER,
            external_id TEXT,
            meta TEXT,
            content_hash TEXT,
            content_size INTEGER,
            deleted_at INTEGER,
            deleted_from_notebook_id INTEGER,
            FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notes_text (
            note_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
         USING fts5(title, plain_text, content='notes_text', content_rowid='note_id')",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ocr_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            attempts_left INTEGER NOT NULL DEFAULT 3,
            last_error TEXT
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_files (
            note_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            PRIMARY KEY(note_id, file_id),
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY(file_id) REFERENCES ocr_files(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ocr_text (
            file_id INTEGER PRIMARY KEY,
            lang TEXT NOT NULL,
            text TEXT NOT NULL,
            hash TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(file_id) REFERENCES ocr_files(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE VIRTUAL TABLE IF NOT EXISTS ocr_fts
         USING fts5(text, content='ocr_text', content_rowid='file_id')",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS ocr_text_ai AFTER INSERT ON ocr_text BEGIN
            INSERT INTO ocr_fts(rowid, text) VALUES (new.file_id, new.text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS ocr_text_ad AFTER DELETE ON ocr_text BEGIN
            INSERT INTO ocr_fts(ocr_fts, rowid, text) VALUES ('delete', old.file_id, old.text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS ocr_text_au AFTER UPDATE ON ocr_text BEGIN
            INSERT INTO ocr_fts(ocr_fts, rowid, text) VALUES ('delete', old.file_id, old.text);
            INSERT INTO ocr_fts(rowid, text) VALUES (new.file_id, new.text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS notes_text_ai AFTER INSERT ON notes_text BEGIN
            INSERT INTO notes_fts(rowid, title, plain_text) VALUES (new.note_id, new.title, new.plain_text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS notes_text_ad AFTER DELETE ON notes_text BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', old.note_id, old.title, old.plain_text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TRIGGER IF NOT EXISTS notes_text_au AFTER UPDATE ON notes_text BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', old.note_id, old.title, old.plain_text);
            INSERT INTO notes_fts(rowid, title, plain_text) VALUES (new.note_id, new.title, new.plain_text);
         END;",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id)")
        .execute(pool)
        .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at)")
        .execute(pool)
        .await?;

    if column_exists(pool, "notes", "deleted_at").await? {
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)")
            .execute(pool)
            .await?;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            external_id TEXT,
            FOREIGN KEY(parent_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_parent_name ON tags(parent_id, name)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY(note_id, tag_id),
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            external_id TEXT,
            hash TEXT,
            filename TEXT,
            mime TEXT,
            size INTEGER,
            width INTEGER,
            height INTEGER,
            local_path TEXT,
            source_url TEXT,
            is_attachment INTEGER,
            created_at INTEGER,
            updated_at INTEGER,
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id)")
        .execute(pool)
        .await?;

    create_history_table(pool).await?;

    Ok(())
}

async fn create_history_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            opened_at INTEGER NOT NULL,
            note_title TEXT NOT NULL,
            notebook_id INTEGER,
            notebook_name TEXT,
            stack_id INTEGER,
            stack_name TEXT
        )",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_note_history_opened_at ON note_history(opened_at)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_note_history_note_id ON note_history(note_id)")
        .execute(pool)
        .await?;
    Ok(())
}

async fn migrate_to_v4(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    create_schema_v3(pool).await?;

    if !column_exists(pool, "notes", "sync_status").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN sync_status INTEGER DEFAULT 0")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "remote_id").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN remote_id TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "external_id").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN external_id TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "meta").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN meta TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "content_hash").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN content_hash TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "content_size").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN content_size INTEGER")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "deleted_at").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN deleted_at INTEGER")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notes", "deleted_from_notebook_id").await? {
        sqlx::query("ALTER TABLE notes ADD COLUMN deleted_from_notebook_id INTEGER")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "notebooks", "external_id").await? {
        sqlx::query("ALTER TABLE notebooks ADD COLUMN external_id TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "tags", "external_id").await? {
        sqlx::query("ALTER TABLE tags ADD COLUMN external_id TEXT")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "ocr_files", "attempts_left").await? {
        sqlx::query("ALTER TABLE ocr_files ADD COLUMN attempts_left INTEGER NOT NULL DEFAULT 3")
            .execute(pool)
            .await?;
    }
    if !column_exists(pool, "ocr_files", "last_error").await? {
        sqlx::query("ALTER TABLE ocr_files ADD COLUMN last_error TEXT")
            .execute(pool)
            .await?;
    }

    Ok(())
}

async fn migrate_to_v5(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    migrate_to_v4(pool).await?;
    create_history_table(pool).await?;
    Ok(())
}

pub async fn init_db(data_dir: &Path) -> Result<SqlitePool, String> {
    if !data_dir.exists() {
        fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    }
    let db_path = data_dir.join("notes.db");
    if !db_path.exists() {
        fs::File::create(&db_path).map_err(|e| e.to_string())?;
    }

    let db_url = format!(
        "sqlite:{}",
        db_path
            .to_str()
            .ok_or_else(|| "Path is not valid UTF-8".to_string())?
    );
    let pool = SqlitePool::connect(&db_url)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA synchronous = NORMAL")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let version = ensure_schema_version(&pool)
        .await
        .map_err(|e| e.to_string())?;
    if version == 0 {
        create_schema_v3(&pool).await.map_err(|e| e.to_string())?;
        set_schema_version(&pool, SCHEMA_VERSION)
            .await
            .map_err(|e| e.to_string())?;
    } else if version < SCHEMA_VERSION {
        migrate_to_v5(&pool).await.map_err(|e| e.to_string())?;
        set_schema_version(&pool, SCHEMA_VERSION)
            .await
            .map_err(|e| e.to_string())?;
    }
    create_schema_v3(&pool).await.map_err(|e| e.to_string())?;
    let _ = migrate_note_file_scheme(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut structure_changed = false;
    let rows: Vec<(i64, Option<i64>)> = sqlx::query_as("SELECT id, parent_id FROM notebooks")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut parent_map = HashMap::new();
    for (id, parent_id) in &rows {
        parent_map.insert(*id, *parent_id);
    }

    for (id, parent_id) in rows {
        let mut root_id = id;
        let mut current = parent_id;
        while let Some(pid) = current {
            root_id = pid;
            current = parent_map.get(&pid).copied().flatten();
        }

        if parent_id.is_none() {
            sqlx::query("UPDATE notebooks SET notebook_type = 'stack' WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            sqlx::query(
                "UPDATE notebooks SET notebook_type = 'notebook', parent_id = ? WHERE id = ?",
            )
            .bind(root_id)
            .bind(id)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
            if parent_id != Some(root_id) {
                structure_changed = true;
            }
        }
    }

    if structure_changed {
        let parents: Vec<(Option<i64>,)> =
            sqlx::query_as("SELECT DISTINCT parent_id FROM notebooks")
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
        for (parent_id,) in parents {
            let ids: Vec<(i64,)> = if let Some(pid) = parent_id {
                sqlx::query_as("SELECT id FROM notebooks WHERE parent_id = ? ORDER BY name ASC, created_at ASC")
                    .bind(pid)
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                sqlx::query_as("SELECT id FROM notebooks WHERE parent_id IS NULL ORDER BY name ASC, created_at ASC")
                    .fetch_all(&pool)
                    .await
                    .map_err(|e| e.to_string())?
            };
            for (index, (id,)) in ids.iter().enumerate() {
                sqlx::query("UPDATE notebooks SET sort_order = ? WHERE id = ?")
                    .bind(index as i64)
                    .bind(id)
                    .execute(&pool)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    let text_count: Option<(i64,)> = sqlx::query_as("SELECT COUNT(*) FROM notes_text")
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let notes_count: Option<(i64,)> = sqlx::query_as("SELECT COUNT(*) FROM notes")
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let needs_text = match (text_count, notes_count) {
        (Some((text,)), Some((notes,))) => text < notes,
        _ => true,
    };
    if needs_text {
        let notes: Vec<(i64, String, String)> =
            sqlx::query_as("SELECT id, title, content FROM notes")
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;
        for (id, title, content) in notes {
            let plain = strip_html(&content);
            sqlx::query(
                "INSERT INTO notes_text (note_id, title, plain_text)
                 VALUES (?, ?, ?)
                 ON CONFLICT(note_id) DO UPDATE SET title = excluded.title, plain_text = excluded.plain_text",
            )
            .bind(id)
            .bind(title)
            .bind(plain)
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(pool)
}

pub struct SqliteRepository {
    pub pool: SqlitePool,
}

impl SqliteRepository {
    async fn upsert_note_text_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        title: &str,
        content: &str,
    ) -> Result<(), sqlx::Error> {
        let plain = strip_html(content);
        sqlx::query(
            "INSERT INTO notes_text (note_id, title, plain_text)
             VALUES (?, ?, ?)
             ON CONFLICT(note_id) DO UPDATE SET title = excluded.title, plain_text = excluded.plain_text",
        )
        .bind(note_id)
        .bind(title)
        .bind(plain)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn sync_note_files_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        content: &str,
    ) -> Result<Vec<(i64, String)>, sqlx::Error> {
        let files = extract_note_files(content);
        sqlx::query("DELETE FROM note_files WHERE note_id = ?")
            .bind(note_id)
            .execute(&mut **tx)
            .await?;
        let mut mapped = Vec::new();
        for file_path in files {
            sqlx::query(
                "INSERT INTO ocr_files (file_path) VALUES (?) ON CONFLICT(file_path) DO NOTHING",
            )
            .bind(&file_path)
            .execute(&mut **tx)
            .await?;
            let (file_id,): (i64,) = sqlx::query_as("SELECT id FROM ocr_files WHERE file_path = ?")
                .bind(&file_path)
                .fetch_one(&mut **tx)
                .await?;
            sqlx::query(
                "INSERT INTO note_files (note_id, file_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(note_id)
            .bind(file_id)
            .execute(&mut **tx)
            .await?;
            mapped.push((file_id, file_path));
        }
        Ok(mapped)
    }

    async fn cleanup_orphan_note_files_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ) -> Result<Vec<String>, sqlx::Error> {
        let orphan_files: Vec<(i64, String)> = sqlx::query_as(
            "SELECT f.id, f.file_path
             FROM ocr_files f
             LEFT JOIN note_files nf ON nf.file_id = f.id
             WHERE nf.file_id IS NULL",
        )
        .fetch_all(&mut **tx)
        .await?;
        for (id, _) in &orphan_files {
            sqlx::query("DELETE FROM ocr_files WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        Ok(orphan_files.into_iter().map(|(_, path)| path).collect())
    }

    async fn cleanup_note_attachments_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        keep_ids: &HashSet<i64>,
    ) -> Result<Vec<String>, sqlx::Error> {
        let existing: Vec<(i64, Option<String>)> =
            sqlx::query_as("SELECT id, local_path FROM attachments WHERE note_id = ?")
                .bind(note_id)
                .fetch_all(&mut **tx)
                .await?;
        let mut removed = Vec::new();
        for (id, path) in existing {
            if keep_ids.contains(&id) {
                continue;
            }
            sqlx::query("DELETE FROM attachments WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
            if let Some(path) = path {
                if !path.is_empty() {
                    removed.push(path);
                }
            }
        }
        Ok(removed)
    }

    async fn sync_note_files(
        &self,
        note_id: i64,
        content: &str,
    ) -> Result<Vec<(i64, String)>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let mapped = self.sync_note_files_tx(&mut tx, note_id, content).await?;
        tx.commit().await?;
        Ok(mapped)
    }

    pub async fn get_notebooks(&self) -> Result<Vec<Notebook>, sqlx::Error> {
        sqlx::query_as::<_, Notebook>(
            "SELECT * FROM notebooks ORDER BY parent_id IS NOT NULL, parent_id, sort_order ASC, name ASC",
        )
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_notebook(
        &self,
        name: &str,
        parent_id: Option<i64>,
    ) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let notebook_type = if parent_id.is_some() {
            "notebook"
        } else {
            "stack"
        };
        if let Some(pid) = parent_id {
            let parent_type: Option<(String,)> =
                sqlx::query_as("SELECT notebook_type FROM notebooks WHERE id = ?")
                    .bind(pid)
                    .fetch_optional(&self.pool)
                    .await?;
            if let Some((ptype,)) = parent_type {
                if ptype != "stack" {
                    return Err(sqlx::Error::RowNotFound);
                }
            }
        }
        let max_order: Option<(Option<i64>,)> = if let Some(pid) = parent_id {
            sqlx::query_as("SELECT MAX(sort_order) FROM notebooks WHERE parent_id = ?")
                .bind(pid)
                .fetch_optional(&self.pool)
                .await?
        } else {
            sqlx::query_as("SELECT MAX(sort_order) FROM notebooks WHERE parent_id IS NULL")
                .fetch_optional(&self.pool)
                .await?
        };
        let next_order = max_order.and_then(|(v,)| v).unwrap_or(-1) + 1;
        let res = sqlx::query("INSERT INTO notebooks (name, created_at, parent_id, notebook_type, sort_order) VALUES (?, ?, ?, ?, ?)")
            .bind(name)
            .bind(now)
            .bind(parent_id)
            .bind(notebook_type)
            .bind(next_order)
            .execute(&self.pool)
            .await?;
        Ok(res.last_insert_rowid())
    }

    pub async fn delete_notebook(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM notebooks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn move_notebook(
        &self,
        notebook_id: i64,
        target_parent_id: Option<i64>,
        target_index: usize,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let current: Option<(Option<i64>, i64, String)> = sqlx::query_as(
            "SELECT parent_id, sort_order, notebook_type FROM notebooks WHERE id = ?",
        )
        .bind(notebook_id)
        .fetch_optional(&mut *tx)
        .await?;
        let (current_parent_id, _current_order, current_type) = match current {
            Some(data) => data,
            None => return Ok(()),
        };

        if current_type == "stack" && target_parent_id.is_some() {
            return Ok(());
        }
        if current_type == "notebook" {
            if target_parent_id.is_none() {
                return Ok(());
            }
            let parent_type: Option<(String,)> =
                sqlx::query_as("SELECT notebook_type FROM notebooks WHERE id = ?")
                    .bind(target_parent_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            if let Some((ptype,)) = parent_type {
                if ptype != "stack" {
                    return Ok(());
                }
            }
        }

        let source_ids: Vec<i64> = if let Some(pid) = current_parent_id {
            sqlx::query_as("SELECT id FROM notebooks WHERE parent_id = ? AND id != ? ORDER BY sort_order ASC, name ASC")
                .bind(pid)
                .bind(notebook_id)
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|(id,)| id)
                .collect()
        } else {
            sqlx::query_as("SELECT id FROM notebooks WHERE parent_id IS NULL AND id != ? ORDER BY sort_order ASC, name ASC")
                .bind(notebook_id)
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|(id,)| id)
                .collect()
        };

        let mut target_ids: Vec<i64> = if let Some(pid) = target_parent_id {
            sqlx::query_as("SELECT id FROM notebooks WHERE parent_id = ? AND id != ? ORDER BY sort_order ASC, name ASC")
                .bind(pid)
                .bind(notebook_id)
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|(id,)| id)
                .collect()
        } else {
            sqlx::query_as("SELECT id FROM notebooks WHERE parent_id IS NULL AND id != ? ORDER BY sort_order ASC, name ASC")
                .bind(notebook_id)
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|(id,)| id)
                .collect()
        };

        let insert_index = target_index.min(target_ids.len());

        target_ids.insert(insert_index, notebook_id);

        if current_parent_id == target_parent_id {
            for (index, id) in target_ids.iter().enumerate() {
                sqlx::query("UPDATE notebooks SET sort_order = ? WHERE id = ?")
                    .bind(index as i64)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        } else {
            for (index, id) in source_ids.iter().enumerate() {
                sqlx::query("UPDATE notebooks SET sort_order = ? WHERE id = ?")
                    .bind(index as i64)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
            for (index, id) in target_ids.iter().enumerate() {
                sqlx::query("UPDATE notebooks SET parent_id = ?, sort_order = ? WHERE id = ?")
                    .bind(target_parent_id)
                    .bind(index as i64)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_all_notes(
        &self,
        notebook_id: Option<i64>,
    ) -> Result<Vec<NoteListItem>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, NoteListItem>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                )
                SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match FROM notes
                WHERE deleted_at IS NULL
                  AND notebook_id IN (SELECT id FROM descendant_notebooks)
                ORDER BY updated_at DESC, created_at DESC, id DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match
                 FROM notes
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC, created_at DESC, id DESC",
            )
                .fetch_all(&self.pool)
                .await
        }
    }

    pub async fn get_note(&self, id: i64) -> Result<Option<Note>, sqlx::Error> {
        sqlx::query_as::<_, Note>("SELECT * FROM notes WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_note_counts(&self) -> Result<NoteCounts, sqlx::Error> {
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
            .fetch_one(&self.pool)
            .await?;
        let trashed: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL")
                .fetch_one(&self.pool)
                .await?;
        let per_notebook = sqlx::query_as::<_, NoteCountItem>(
            "SELECT notebook_id, COUNT(*) AS count
             FROM notes
             WHERE notebook_id IS NOT NULL AND deleted_at IS NULL
             GROUP BY notebook_id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(NoteCounts {
            total: total.0,
            trashed: trashed.0,
            per_notebook,
        })
    }

    pub async fn create_note(
        &self,
        title: &str,
        content: &str,
        notebook_id: Option<i64>,
        data_dir: &Path,
    ) -> Result<i64, sqlx::Error> {
        let _ = data_dir;
        let now = chrono::Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query("INSERT INTO notes (title, content, created_at, updated_at, notebook_id) VALUES (?, ?, ?, ?, ?)")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(now)
            .bind(notebook_id)
            .execute(&mut *tx)
            .await?;
        let id = result.last_insert_rowid();
        self.upsert_note_text_tx(&mut tx, id, title, content)
            .await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn search_notes_by_title(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<NoteLinkItem>, sqlx::Error> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let like = format!("%{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));
        sqlx::query_as::<_, NoteLinkItem>(
            "SELECT id, title, notebook_id, external_id
             FROM notes
             WHERE deleted_at IS NULL AND LOWER(title) LIKE LOWER(?) ESCAPE '\\'
             ORDER BY updated_at DESC
             LIMIT ?",
        )
        .bind(like)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_note_id_by_external_id(
        &self,
        external_id: &str,
    ) -> Result<Option<i64>, sqlx::Error> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM notes WHERE external_id = ? AND deleted_at IS NULL LIMIT 1",
        )
        .bind(external_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|value| value.0))
    }

    pub async fn set_note_external_id(
        &self,
        note_id: i64,
        external_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET external_id = ? WHERE id = ?")
            .bind(external_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_note_notebook(
        &self,
        note_id: i64,
        notebook_id: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET notebook_id = ? WHERE id = ?")
            .bind(notebook_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_note(
        &self,
        id: i64,
        title: &str,
        content: &str,
        notebook_id: Option<i64>,
        data_dir: &Path,
    ) -> Result<(), sqlx::Error> {
        let attachment_ids = extract_attachment_ids(content);
        let now = chrono::Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE notes SET title = ?, content = ?, updated_at = ?, notebook_id = ? WHERE id = ?",
        )
        .bind(title)
        .bind(content)
        .bind(now)
        .bind(notebook_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        self.upsert_note_text_tx(&mut tx, id, title, content)
            .await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        let removed_attachments = self
            .cleanup_note_attachments_tx(&mut tx, id, &attachment_ids)
            .await?;
        let orphan_files = self.cleanup_orphan_note_files_tx(&mut tx).await?;
        tx.commit().await?;
        for path in removed_attachments {
            let full_path = data_dir.join(path);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        for rel in orphan_files {
            let full_path = data_dir.join("files").join(&rel);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        Ok(())
    }

    pub async fn search_notes(
        &self,
        query: &str,
        notebook_id: Option<i64>,
    ) -> Result<Vec<NoteListItem>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, NoteListItem>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                ),
                text_matches AS (
                    SELECT n.id, n.title,
                           snippet(notes_fts, 1, '', '', '...', 20) AS content,
                           n.updated_at, n.notebook_id,
                           0 AS ocr_match
                    FROM notes_fts
                    JOIN notes n ON n.id = notes_fts.rowid
                    WHERE notes_fts MATCH ?
                      AND n.deleted_at IS NULL
                      AND n.notebook_id IN (SELECT id FROM descendant_notebooks)
                ),
                ocr_matches AS (
                    SELECT n.id, n.title,
                           '' AS content,
                           n.updated_at, n.notebook_id,
                           1 AS ocr_match
                    FROM ocr_fts
                    JOIN note_files nf ON nf.file_id = ocr_fts.rowid
                    JOIN notes n ON n.id = nf.note_id
                    WHERE ocr_fts MATCH ?
                      AND n.deleted_at IS NULL
                      AND n.notebook_id IN (SELECT id FROM descendant_notebooks)
                )
                SELECT id, title,
                       MAX(content) AS content,
                       updated_at, notebook_id,
                       MAX(ocr_match) AS ocr_match
                FROM (
                    SELECT * FROM text_matches
                    UNION ALL
                    SELECT * FROM ocr_matches
                )
                GROUP BY id, title, updated_at, notebook_id
                ORDER BY updated_at DESC, id DESC",
            )
            .bind(id)
            .bind(query)
            .bind(query)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "WITH text_matches AS (
                    SELECT n.id, n.title,
                           snippet(notes_fts, 1, '', '', '...', 20) AS content,
                           n.updated_at, n.notebook_id,
                           0 AS ocr_match
                    FROM notes_fts
                    JOIN notes n ON n.id = notes_fts.rowid
                    WHERE notes_fts MATCH ?
                      AND n.deleted_at IS NULL
                ),
                ocr_matches AS (
                    SELECT n.id, n.title,
                           '' AS content,
                           n.updated_at, n.notebook_id,
                           1 AS ocr_match
                    FROM ocr_fts
                    JOIN note_files nf ON nf.file_id = ocr_fts.rowid
                    JOIN notes n ON n.id = nf.note_id
                    WHERE ocr_fts MATCH ?
                      AND n.deleted_at IS NULL
                )
                SELECT id, title,
                       MAX(content) AS content,
                       updated_at, notebook_id,
                       MAX(ocr_match) AS ocr_match
                FROM (
                    SELECT * FROM text_matches
                    UNION ALL
                    SELECT * FROM ocr_matches
                )
                GROUP BY id, title, updated_at, notebook_id
                ORDER BY updated_at DESC, id DESC",
            )
            .bind(query)
            .bind(query)
            .fetch_all(&self.pool)
            .await
        }
    }

    pub async fn get_notes_by_tag(&self, tag_id: i64) -> Result<Vec<NoteListItem>, sqlx::Error> {
        sqlx::query_as::<_, NoteListItem>(
            "SELECT n.id, n.title, n.content, n.updated_at, n.notebook_id, 0 AS ocr_match
             FROM notes n
             JOIN note_tags nt ON nt.note_id = n.id
             WHERE nt.tag_id = ?
               AND n.deleted_at IS NULL
             ORDER BY n.updated_at DESC, n.created_at DESC, n.id DESC",
        )
        .bind(tag_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_trashed_notes(&self) -> Result<Vec<NoteListItem>, sqlx::Error> {
        sqlx::query_as::<_, NoteListItem>(
            "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match
             FROM notes
             WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC, updated_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn delete_note(&self, id: i64, data_dir: &Path) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let attachment_paths: Vec<(Option<String>,)> =
            sqlx::query_as("SELECT local_path FROM attachments WHERE note_id = ?")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        sqlx::query("DELETE FROM notes WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM notes_text WHERE note_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let orphan_files = self.cleanup_orphan_note_files_tx(&mut tx).await?;
        tx.commit().await?;
        for (path_opt,) in attachment_paths {
            let Some(path) = path_opt else { continue };
            if path.is_empty() {
                continue;
            }
            let full_path = data_dir.join(path);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        for rel in orphan_files {
            let full_path = data_dir.join("files").join(&rel);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        Ok(())
    }

    pub async fn trash_note(&self, id: i64) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query(
            "UPDATE notes
             SET deleted_at = ?,
                 deleted_from_notebook_id = notebook_id,
                 notebook_id = NULL
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn restore_note(&self, id: i64) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT deleted_from_notebook_id FROM notes WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let target_notebook_id = if let Some((candidate,)) = row {
            if let Some(notebook_id) = candidate {
                let exists: Option<(i64,)> =
                    sqlx::query_as("SELECT id FROM notebooks WHERE id = ?")
                        .bind(notebook_id)
                        .fetch_optional(&mut *tx)
                        .await?;
                if exists.is_some() {
                    Some(notebook_id)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        sqlx::query(
            "UPDATE notes
             SET deleted_at = NULL,
                 deleted_from_notebook_id = NULL,
                 notebook_id = ?
             WHERE id = ?",
        )
        .bind(target_notebook_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn restore_all_notes(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE notes
             SET notebook_id = (
                 SELECT id FROM notebooks WHERE id = notes.deleted_from_notebook_id
             ),
                 deleted_at = NULL,
                 deleted_from_notebook_id = NULL
             WHERE deleted_at IS NOT NULL",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn create_attachment(
        &self,
        note_id: i64,
        filename: &str,
        mime: &str,
        size: i64,
    ) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let result = sqlx::query(
            "INSERT INTO attachments (note_id, filename, mime, size, local_path, is_attachment, created_at, updated_at)
             VALUES (?, ?, ?, ?, '', 1, ?, ?)",
        )
        .bind(note_id)
        .bind(filename)
        .bind(mime)
        .bind(size)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn update_attachment_path(
        &self,
        id: i64,
        local_path: &str,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE attachments SET local_path = ?, updated_at = ? WHERE id = ?")
            .bind(local_path)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_attachment(&self, id: i64) -> Result<Option<Attachment>, sqlx::Error> {
        sqlx::query_as::<_, Attachment>(
            "SELECT id,
                    note_id,
                    COALESCE(filename, '') AS filename,
                    COALESCE(mime, '') AS mime,
                    COALESCE(size, 0) AS size,
                    COALESCE(local_path, '') AS local_path
             FROM attachments
             WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn get_attachment_by_path(
        &self,
        local_path: &str,
    ) -> Result<Option<Attachment>, sqlx::Error> {
        sqlx::query_as::<_, Attachment>(
            "SELECT id,
                    note_id,
                    COALESCE(filename, '') AS filename,
                    COALESCE(mime, '') AS mime,
                    COALESCE(size, 0) AS size,
                    COALESCE(local_path, '') AS local_path
             FROM attachments
             WHERE local_path = ?",
        )
        .bind(local_path)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn delete_attachment(&self, id: i64) -> Result<Option<String>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row: Option<(String,)> =
            sqlx::query_as("SELECT local_path FROM attachments WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        sqlx::query("DELETE FROM attachments WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(row.and_then(|(path,)| if path.is_empty() { None } else { Some(path) }))
    }

    pub async fn get_tags(&self) -> Result<Vec<Tag>, sqlx::Error> {
        sqlx::query_as::<_, Tag>(
            "SELECT * FROM tags ORDER BY parent_id IS NOT NULL, parent_id, name",
        )
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_note_tags(&self, note_id: i64) -> Result<Vec<Tag>, sqlx::Error> {
        sqlx::query_as::<_, Tag>(
            "SELECT t.* FROM tags t
             JOIN note_tags nt ON nt.tag_id = t.id
             WHERE nt.note_id = ?
             ORDER BY t.parent_id IS NOT NULL, t.parent_id, t.name",
        )
        .bind(note_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn add_history_entry(
        &self,
        note_id: i64,
        min_gap_seconds: i64,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        if min_gap_seconds > 0 {
            let last: Option<(i64,)> = sqlx::query_as(
                "SELECT opened_at FROM note_history WHERE note_id = ? ORDER BY opened_at DESC LIMIT 1",
            )
            .bind(note_id)
            .fetch_optional(&self.pool)
            .await?;
            if let Some((opened_at,)) = last {
                if now - opened_at < min_gap_seconds {
                    return Ok(());
                }
            }
        }

        let row: Option<(
            String,
            Option<i64>,
            Option<String>,
            Option<i64>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT n.title,
                    n.notebook_id,
                    nb.name,
                    nb.parent_id,
                    stack.name
             FROM notes n
             LEFT JOIN notebooks nb ON nb.id = n.notebook_id
             LEFT JOIN notebooks stack ON stack.id = nb.parent_id
             WHERE n.id = ?",
        )
        .bind(note_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((title, notebook_id, notebook_name, stack_id, stack_name)) = row else {
            return Ok(());
        };

        sqlx::query(
            "INSERT INTO note_history (note_id, opened_at, note_title, notebook_id, notebook_name, stack_id, stack_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(note_id)
        .bind(now)
        .bind(title)
        .bind(notebook_id)
        .bind(notebook_name)
        .bind(stack_id)
        .bind(stack_name)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_note_history(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<NoteHistoryItem>, sqlx::Error> {
        sqlx::query_as::<_, NoteHistoryItem>(
            "SELECT id,
                    note_id,
                    opened_at,
                    note_title,
                    notebook_id,
                    notebook_name,
                    stack_id,
                    stack_name
             FROM note_history
             ORDER BY opened_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn clear_note_history(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM note_history")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn cleanup_note_history(&self, days: i64) -> Result<(), sqlx::Error> {
        if days <= 0 {
            return Ok(());
        }
        let cutoff = chrono::Utc::now().timestamp() - (days * 86400);
        sqlx::query("DELETE FROM note_history WHERE opened_at < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn backfill_note_files(&self) -> Result<(), sqlx::Error> {
        let notes: Vec<(i64, String)> = sqlx::query_as("SELECT id, content FROM notes")
            .fetch_all(&self.pool)
            .await?;
        for (note_id, content) in notes {
            let _ = self.sync_note_files(note_id, &content).await?;
        }
        Ok(())
    }

    pub async fn backfill_note_files_and_ocr(&self, _data_dir: &Path) -> Result<(), sqlx::Error> {
        self.backfill_note_files().await
    }

    pub async fn needs_note_files_backfill(&self) -> Result<bool, sqlx::Error> {
        let (notes_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&self.pool)
            .await?;
        if notes_count == 0 {
            return Ok(false);
        }
        let (note_files_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM note_files")
            .fetch_one(&self.pool)
            .await?;
        let (ocr_files_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ocr_files")
            .fetch_one(&self.pool)
            .await?;
        Ok(note_files_count == 0 || ocr_files_count == 0)
    }

    pub async fn get_ocr_pending_files(&self, limit: i64) -> Result<Vec<OcrFileItem>, sqlx::Error> {
        let (notes_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&self.pool)
            .await?;
        let (ocr_files_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ocr_files")
            .fetch_one(&self.pool)
            .await?;
        if notes_count > 0 && ocr_files_count == 0 {
            let _ = self.backfill_note_files().await?;
        }
        let query = format!(
            "SELECT f.id AS file_id, f.file_path, a.mime
             FROM ocr_files f
             LEFT JOIN ocr_text t ON t.file_id = f.id
             LEFT JOIN attachments a ON a.local_path = ('files/' || f.file_path)
             WHERE t.file_id IS NULL
               AND f.attempts_left > 0
               AND {filter}
             ORDER BY f.id ASC
             LIMIT ?",
            filter = OCR_IMAGE_FILTER
        );
        sqlx::query_as::<_, OcrFileItem>(&query)
            .bind(limit)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn upsert_ocr_text(
        &self,
        file_id: i64,
        lang: &str,
        text: &str,
        hash: &str,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query(
            "INSERT INTO ocr_text (file_id, lang, text, hash, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(file_id) DO UPDATE SET lang = excluded.lang, text = excluded.text, hash = excluded.hash, updated_at = excluded.updated_at",
        )
        .bind(file_id)
        .bind(lang)
        .bind(text)
        .bind(hash)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_ocr_failed(&self, file_id: i64, message: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE ocr_files
             SET attempts_left = MAX(attempts_left - 1, 0),
                 last_error = ?
             WHERE id = ?",
        )
        .bind(message)
        .bind(file_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_ocr_stats(&self) -> Result<OcrStats, sqlx::Error> {
        let (notes_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&self.pool)
            .await?;
        let (ocr_files_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ocr_files")
            .fetch_one(&self.pool)
            .await?;
        if notes_count > 0 && ocr_files_count == 0 {
            let _ = self.backfill_note_files().await?;
        }
        let total_query = format!(
            "SELECT COUNT(*) FROM ocr_files f
             LEFT JOIN attachments a ON a.local_path = ('files/' || f.file_path)
             WHERE {filter}",
            filter = OCR_IMAGE_FILTER
        );
        let (total,): (i64,) = sqlx::query_as(&total_query).fetch_one(&self.pool).await?;
        let done_query = format!(
            "SELECT COUNT(*) FROM ocr_text t
             JOIN ocr_files f ON f.id = t.file_id
             LEFT JOIN attachments a ON a.local_path = ('files/' || f.file_path)
             WHERE {filter}",
            filter = OCR_IMAGE_FILTER
        );
        let (done,): (i64,) = sqlx::query_as(&done_query).fetch_one(&self.pool).await?;
        let pending_query = format!(
            "SELECT COUNT(*) FROM ocr_files f
             LEFT JOIN ocr_text t ON t.file_id = f.id
             LEFT JOIN attachments a ON a.local_path = ('files/' || f.file_path)
             WHERE t.file_id IS NULL AND f.attempts_left > 0 AND {filter}",
            filter = OCR_IMAGE_FILTER
        );
        let (pending,): (i64,) = sqlx::query_as(&pending_query).fetch_one(&self.pool).await?;
        Ok(OcrStats {
            total,
            done,
            pending,
        })
    }

    pub async fn create_tag(&self, name: &str, parent_id: Option<i64>) -> Result<i64, sqlx::Error> {
        let existing: Option<(i64,)> = if let Some(pid) = parent_id {
            sqlx::query_as("SELECT id FROM tags WHERE name = ? AND parent_id = ?")
                .bind(name)
                .bind(pid)
                .fetch_optional(&self.pool)
                .await?
        } else {
            sqlx::query_as("SELECT id FROM tags WHERE name = ? AND parent_id IS NULL")
                .bind(name)
                .fetch_optional(&self.pool)
                .await?
        };
        if let Some((id,)) = existing {
            return Ok(id);
        }
        let now = chrono::Utc::now().timestamp();
        let result = sqlx::query(
            "INSERT INTO tags (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(name)
        .bind(parent_id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn add_note_tag(&self, note_id: i64, tag_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)")
            .bind(note_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_tag(&self, tag_id: i64) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "WITH RECURSIVE tag_tree(id) AS (
               SELECT id FROM tags WHERE id = ?
               UNION ALL
               SELECT t.id FROM tags t
               JOIN tag_tree tt ON t.parent_id = tt.id
             )
             DELETE FROM note_tags WHERE tag_id IN (SELECT id FROM tag_tree)",
        )
        .bind(tag_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "WITH RECURSIVE tag_tree(id) AS (
               SELECT id FROM tags WHERE id = ?
               UNION ALL
               SELECT t.id FROM tags t
               JOIN tag_tree tt ON t.parent_id = tt.id
             )
             DELETE FROM tags WHERE id IN (SELECT id FROM tag_tree)",
        )
        .bind(tag_id)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn update_tag_parent(
        &self,
        tag_id: i64,
        parent_id: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE tags SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(parent_id)
            .bind(now)
            .bind(tag_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn remove_note_tag(&self, note_id: i64, tag_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?")
            .bind(note_id)
            .bind(tag_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
