use crate::db::utils::strip_html;
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const SCHEMA_VERSION: i64 = 5;

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
