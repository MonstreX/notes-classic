use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub parent_id: Option<i64>,
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
}

pub struct DbState {
    pub pool: SqlitePool,
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

pub async fn init_db(app_dir: &Path) -> SqlitePool {
    if !app_dir.exists() {
        fs::create_dir_all(app_dir).expect("Could not create app directory");
    }

    let db_path = app_dir.join("notes_classic.db");
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
            FOREIGN KEY(notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
        )",
    )
    .execute(&pool)
    .await
    .expect("Failed to create notes table");

    pool
}

pub struct SqliteRepository {
    pub pool: SqlitePool,
}

impl SqliteRepository {
    pub async fn get_notebooks(&self) -> Result<Vec<Notebook>, sqlx::Error> {
        sqlx::query_as::<_, Notebook>("SELECT * FROM notebooks ORDER BY name ASC")
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_notebook(&self, name: &str, parent_id: Option<i64>) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let res = sqlx::query("INSERT INTO notebooks (name, created_at, parent_id) VALUES (?, ?, ?)")
            .bind(name)
            .bind(now)
            .bind(parent_id)
            .execute(&self.pool)
            .await?;
        Ok(res.last_insert_rowid())
    }

    pub async fn delete_notebook(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM notebooks WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn get_all_notes(&self, notebook_id: Option<i64>) -> Result<Vec<Note>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, Note>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                )
                SELECT * FROM notes
                WHERE notebook_id IN (SELECT id FROM descendant_notebooks)
                ORDER BY updated_at DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, Note>("SELECT * FROM notes ORDER BY updated_at DESC")
                .fetch_all(&self.pool)
                .await
        }
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
