use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use regex::Regex;
use std::collections::HashMap;
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
    results.sort();
    results.dedup();
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
pub struct OcrFileItem {
    pub file_id: i64,
    pub file_path: String,
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
    pub per_notebook: Vec<NoteCountItem>,
}

const SCHEMA_VERSION: i64 = 3;

async fn table_exists(pool: &SqlitePool, name: &str) -> Result<bool, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, sqlx::Error> {
    let table = table.replace('\'', "''");
    let query = format!("SELECT name FROM pragma_table_info('{}') WHERE name = ?", table);
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

    Ok(())
}

async fn migrate_to_v3(pool: &SqlitePool) -> Result<(), sqlx::Error> {
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


pub async fn init_db(data_dir: &Path) -> SqlitePool {
    if !data_dir.exists() {
        fs::create_dir_all(data_dir).expect("Could not create data directory");
    }
    let ocr_dir = data_dir.join("ocr").join("tessdata");
    if !ocr_dir.exists() {
        fs::create_dir_all(&ocr_dir).ok();
    }

    let db_path = data_dir.join("notes.db");
    if !db_path.exists() {
        fs::File::create(&db_path).expect("Failed to create database file");
    }

    let db_url = format!("sqlite:{}", db_path.to_str().expect("Path is not valid UTF-8"));
    let pool = SqlitePool::connect(&db_url).await.expect("Failed to connect to SQLite");
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .expect("Failed to enable foreign keys");
    let version = ensure_schema_version(&pool)
        .await
        .expect("Failed to ensure schema_version");
    if version == 0 {
        create_schema_v3(&pool)
            .await
            .expect("Failed to create schema v2");
        set_schema_version(&pool, SCHEMA_VERSION)
            .await
            .expect("Failed to set schema version");
    } else if version < SCHEMA_VERSION {
        migrate_to_v3(&pool)
            .await
            .expect("Failed to migrate schema");
        set_schema_version(&pool, SCHEMA_VERSION)
            .await
            .expect("Failed to set schema version");
    }
    create_schema_v3(&pool)
        .await
        .expect("Failed to ensure schema");

    let mut structure_changed = false;
    let rows: Vec<(i64, Option<i64>)> = sqlx::query_as("SELECT id, parent_id FROM notebooks")
        .fetch_all(&pool)
        .await
        .expect("Failed to read notebooks for normalization");
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
                .expect("Failed to set stack type");
        } else {
            sqlx::query("UPDATE notebooks SET notebook_type = 'notebook', parent_id = ? WHERE id = ?")
                .bind(root_id)
                .bind(id)
                .execute(&pool)
                .await
                .expect("Failed to normalize notebook type");
            if parent_id != Some(root_id) {
                structure_changed = true;
            }
        }
    }

    if structure_changed {
        let parents: Vec<(Option<i64>,)> = sqlx::query_as("SELECT DISTINCT parent_id FROM notebooks")
            .fetch_all(&pool)
            .await
            .expect("Failed to read notebook parents");
        for (parent_id,) in parents {
            let ids: Vec<(i64,)> = if let Some(pid) = parent_id {
                sqlx::query_as("SELECT id FROM notebooks WHERE parent_id = ? ORDER BY name ASC, created_at ASC")
                    .bind(pid)
                    .fetch_all(&pool)
                    .await
                    .expect("Failed to read notebooks")
            } else {
                sqlx::query_as("SELECT id FROM notebooks WHERE parent_id IS NULL ORDER BY name ASC, created_at ASC")
                    .fetch_all(&pool)
                    .await
                    .expect("Failed to read notebooks")
            };
            for (index, (id,)) in ids.iter().enumerate() {
                sqlx::query("UPDATE notebooks SET sort_order = ? WHERE id = ?")
                    .bind(index as i64)
                    .bind(id)
                    .execute(&pool)
                    .await
                    .expect("Failed to update sort_order");
            }
        }
    }

    let text_count: Option<(i64,)> = sqlx::query_as("SELECT COUNT(*) FROM notes_text")
        .fetch_optional(&pool)
        .await
        .expect("Failed to read notes_text count");
    let notes_count: Option<(i64,)> = sqlx::query_as("SELECT COUNT(*) FROM notes")
        .fetch_optional(&pool)
        .await
        .expect("Failed to read notes count");
    let needs_text = match (text_count, notes_count) {
        (Some((text,)), Some((notes,))) => text < notes,
        _ => true,
    };
    if needs_text {
        let notes: Vec<(i64, String, String)> = sqlx::query_as("SELECT id, title, content FROM notes")
            .fetch_all(&pool)
            .await
            .expect("Failed to read notes for text index");
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
            .expect("Failed to backfill notes_text");
        }
    }

    pool
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
            sqlx::query("INSERT INTO ocr_files (file_path) VALUES (?) ON CONFLICT(file_path) DO NOTHING")
                .bind(&file_path)
                .execute(&mut **tx)
                .await?;
            let (file_id,): (i64,) = sqlx::query_as("SELECT id FROM ocr_files WHERE file_path = ?")
                .bind(&file_path)
                .fetch_one(&mut **tx)
                .await?;
            sqlx::query("INSERT INTO note_files (note_id, file_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
                .bind(note_id)
                .bind(file_id)
                .execute(&mut **tx)
                .await?;
            mapped.push((file_id, file_path));
        }
        Ok(mapped)
    }

    async fn sync_note_files(&self, note_id: i64, content: &str) -> Result<Vec<(i64, String)>, sqlx::Error> {
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

    pub async fn create_notebook(&self, name: &str, parent_id: Option<i64>) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let notebook_type = if parent_id.is_some() { "notebook" } else { "stack" };
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
        sqlx::query("DELETE FROM notebooks WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn move_notebook(
        &self,
        notebook_id: i64,
        target_parent_id: Option<i64>,
        target_index: usize,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let current: Option<(Option<i64>, i64, String)> =
            sqlx::query_as("SELECT parent_id, sort_order, notebook_type FROM notebooks WHERE id = ?")
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

    pub async fn get_all_notes(&self, notebook_id: Option<i64>) -> Result<Vec<NoteListItem>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, NoteListItem>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                )
                SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match FROM notes
                WHERE notebook_id IN (SELECT id FROM descendant_notebooks)
                ORDER BY updated_at DESC, created_at DESC, id DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match FROM notes ORDER BY updated_at DESC, created_at DESC, id DESC",
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
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes")
            .fetch_one(&self.pool)
            .await?;
        let per_notebook = sqlx::query_as::<_, NoteCountItem>(
            "SELECT notebook_id, COUNT(*) AS count FROM notes WHERE notebook_id IS NOT NULL GROUP BY notebook_id",
        )
            .fetch_all(&self.pool)
            .await?;
        Ok(NoteCounts { total: total.0, per_notebook })
    }

    pub async fn create_note(&self, title: &str, content: &str, notebook_id: Option<i64>, data_dir: &Path) -> Result<i64, sqlx::Error> {
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
        self.upsert_note_text_tx(&mut tx, id, title, content).await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn update_note_notebook(&self, note_id: i64, notebook_id: Option<i64>) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET notebook_id = ? WHERE id = ?")
            .bind(notebook_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_note(&self, id: i64, title: &str, content: &str, notebook_id: Option<i64>, data_dir: &Path) -> Result<(), sqlx::Error> {
        let _ = data_dir;
        let now = chrono::Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE notes SET title = ?, content = ?, updated_at = ?, notebook_id = ? WHERE id = ?")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(notebook_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        self.upsert_note_text_tx(&mut tx, id, title, content).await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        tx.commit().await?;
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
             ORDER BY n.updated_at DESC, n.created_at DESC, n.id DESC",
        )
        .bind(tag_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn delete_note(&self, id: i64) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM notes WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM notes_text WHERE note_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn get_tags(&self) -> Result<Vec<Tag>, sqlx::Error> {
        sqlx::query_as::<_, Tag>("SELECT * FROM tags ORDER BY parent_id IS NOT NULL, parent_id, name")
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

    pub async fn backfill_note_files_and_ocr(&self, data_dir: &Path) -> Result<(), sqlx::Error> {
        let _ = data_dir;
        let notes: Vec<(i64, String)> = sqlx::query_as("SELECT id, content FROM notes")
            .fetch_all(&self.pool)
            .await?;
        for (note_id, content) in notes {
            let _ = self.sync_note_files(note_id, &content).await?;
        }
        Ok(())
    }

    pub async fn get_ocr_pending_files(&self, limit: i64) -> Result<Vec<OcrFileItem>, sqlx::Error> {
        sqlx::query_as::<_, OcrFileItem>(
            "SELECT f.id AS file_id, f.file_path
             FROM ocr_files f
             LEFT JOIN ocr_text t ON t.file_id = f.id
             WHERE t.file_id IS NULL
               AND f.attempts_left > 0
             ORDER BY f.id ASC
             LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn upsert_ocr_text(&self, file_id: i64, lang: &str, text: &str, hash: &str) -> Result<(), sqlx::Error> {
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
        let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ocr_files")
            .fetch_one(&self.pool)
            .await?;
        let (done,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ocr_text")
            .fetch_one(&self.pool)
            .await?;
        let (pending,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ocr_files f
             LEFT JOIN ocr_text t ON t.file_id = f.id
             WHERE t.file_id IS NULL AND f.attempts_left > 0",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(OcrStats { total, done, pending })
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
