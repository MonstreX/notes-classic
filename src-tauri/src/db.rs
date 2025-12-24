use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Notebook {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
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

    // Таблица блокнотов
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .expect("Failed to create notebooks table");

    // Таблица заметок (с внешним ключом)
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
            FOREIGN KEY(notebook_id) REFERENCES notebooks(id)
        )",
    )
    .execute(&pool)
    .await
    .expect("Failed to create notes table");

    // Если колонка notebook_id не существует (миграция для уже созданной БД)
    let _ = sqlx::query("ALTER TABLE notes ADD COLUMN notebook_id INTEGER REFERENCES notebooks(id)")
        .execute(&pool)
        .await;

    pool
}

pub struct SqliteRepository {
    pub pool: SqlitePool,
}

impl SqliteRepository {
    // --- Notebooks ---
    pub async fn get_notebooks(&self) -> Result<Vec<Notebook>, sqlx::Error> {
        sqlx::query_as::<_, Notebook>("SELECT * FROM notebooks ORDER BY name ASC")
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_notebook(&self, name: &str) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let res = sqlx::query("INSERT INTO notebooks (name, created_at) VALUES (?, ?)")
            .bind(name)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(res.last_insert_rowid())
    }

    pub async fn delete_notebook(&self, id: i64) -> Result<(), sqlx::Error> {
        // При удалении блокнота отвязываем заметки
        sqlx::query("UPDATE notes SET notebook_id = NULL WHERE notebook_id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM notebooks WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(())
    }

    // --- Notes ---
    pub async fn get_all_notes(&self, notebook_id: Option<i64>) -> Result<Vec<Note>, sqlx::Error> {
        let query = match notebook_id {
            Some(_) => "SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC",
            None => "SELECT * FROM notes ORDER BY updated_at DESC",
        };
        
        let mut q = sqlx::query_as::<_, Note>(query);
        if let Some(id) = notebook_id {
            q = q.bind(id);
        }
        
        q.fetch_all(&self.pool).await
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
