use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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
pub struct NoteListItem {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub updated_at: i64,
    pub notebook_id: Option<i64>,
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

async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, sqlx::Error> {
    let table = table.replace('\'', "''");
    let query = format!("SELECT name FROM pragma_table_info('{}') WHERE name = ?", table);
    let row: Option<(String,)> = sqlx::query_as(&query)
        .bind(column)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

pub async fn init_db(data_dir: &Path) -> SqlitePool {
    if !data_dir.exists() {
        fs::create_dir_all(data_dir).expect("Could not create data directory");
    }

    let db_path = data_dir.join("notes.db");
    if !db_path.exists() {
        fs::File::create(&db_path).expect("Failed to create database file");
    }

    let db_url = format!("sqlite:{}", db_path.to_str().expect("Path is not valid UTF-8"));
    let pool = SqlitePool::connect(&db_url).await.expect("Failed to connect to SQLite");

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
    .execute(&pool)
    .await
    .expect("Failed to create notebooks table");

    if !column_exists(&pool, "notebooks", "parent_id")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notebooks ADD COLUMN parent_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE")
            .execute(&pool)
            .await
            .expect("Failed to add parent_id column");
    }

    let mut sort_order_added = false;
    let mut notebook_type_added = false;
    if !column_exists(&pool, "notebooks", "sort_order")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notebooks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            .execute(&pool)
            .await
            .expect("Failed to add sort_order column");
        sort_order_added = true;
    }

    if !column_exists(&pool, "notebooks", "notebook_type")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notebooks ADD COLUMN notebook_type TEXT NOT NULL DEFAULT 'stack'")
            .execute(&pool)
            .await
            .expect("Failed to add notebook_type column");
        notebook_type_added = true;
    }

    if !column_exists(&pool, "notebooks", "external_id")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notebooks ADD COLUMN external_id TEXT")
            .execute(&pool)
            .await
            .expect("Failed to add external_id column");
    }

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
    .execute(&pool)
    .await
    .expect("Failed to create notes table");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notes_notebook_id ON notes(notebook_id)")
        .execute(&pool)
        .await
        .expect("Failed to create notes notebook index");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at)")
        .execute(&pool)
        .await
        .expect("Failed to create notes updated index");

    if !column_exists(&pool, "notes", "external_id")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notes ADD COLUMN external_id TEXT")
            .execute(&pool)
            .await
            .expect("Failed to add external_id column");
    }

    if !column_exists(&pool, "notes", "meta")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notes ADD COLUMN meta TEXT")
            .execute(&pool)
            .await
            .expect("Failed to add meta column");
    }

    if !column_exists(&pool, "notes", "content_hash")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notes ADD COLUMN content_hash TEXT")
            .execute(&pool)
            .await
            .expect("Failed to add content_hash column");
    }

    if !column_exists(&pool, "notes", "content_size")
        .await
        .expect("Failed to check schema")
    {
        sqlx::query("ALTER TABLE notes ADD COLUMN content_size INTEGER")
            .execute(&pool)
            .await
            .expect("Failed to add content_size column");
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
    .execute(&pool)
    .await
    .expect("Failed to create tags table");

    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_parent_name ON tags(parent_id, name)")
        .execute(&pool)
        .await
        .expect("Failed to create tags index");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS note_tags (
            note_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY(note_id, tag_id),
            FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )",
    )
    .execute(&pool)
    .await
    .expect("Failed to create note_tags table");

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
    .execute(&pool)
    .await
    .expect("Failed to create attachments table");

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments(note_id)")
        .execute(&pool)
        .await
        .expect("Failed to create attachments index");

    let mut structure_changed = sort_order_added || notebook_type_added;
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

    pool
}

pub struct SqliteRepository {
    pub pool: SqlitePool,
}

impl SqliteRepository {
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
                SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id FROM notes
                WHERE notebook_id IN (SELECT id FROM descendant_notebooks)
                ORDER BY updated_at DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id FROM notes ORDER BY updated_at DESC",
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

    pub async fn create_note(&self, title: &str, content: &str, notebook_id: Option<i64>) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let result = sqlx::query("INSERT INTO notes (title, content, created_at, updated_at, notebook_id) VALUES (?, ?, ?, ?, ?)")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(now)
            .bind(notebook_id)
            .execute(&self.pool)
            .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn update_note_notebook(&self, note_id: i64, notebook_id: Option<i64>) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET notebook_id = ? WHERE id = ?")
            .bind(notebook_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_note(&self, id: i64, title: &str, content: &str, notebook_id: Option<i64>) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE notes SET title = ?, content = ?, updated_at = ?, notebook_id = ? WHERE id = ?")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(notebook_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_note(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM notes WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(())
    }
}
