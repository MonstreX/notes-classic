use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, FromRow};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sync_status: i32,
    pub remote_id: Option<String>,
}

pub struct DbState {
    pub pool: SqlitePool,
}

pub async fn init_db(app_dir: &Path) -> SqlitePool {
    if !app_dir.exists() {
        fs::create_dir_all(app_dir).expect("Could not create app directory");
    }

    let db_path = app_dir.join("notes_classic.db");
    
    // Create empty file if not exists to avoid connection errors
    if !db_path.exists() {
        fs::File::create(&db_path).expect("Failed to create database file");
    }

    let db_url = format!("sqlite:{}", db_path.to_str().expect("Path is not valid UTF-8"));
    
    let pool = SqlitePool::connect(&db_url)
        .await
        .expect("Failed to connect to SQLite");

    // Create tables
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sync_status INTEGER DEFAULT 0,
            remote_id TEXT
        )",
    )
    .execute(&pool)
    .await
    .expect("Failed to create table");

    pool
}

pub trait NoteRepository {
    async fn get_all_notes(&self) -> Result<Vec<Note>, sqlx::Error>;
    async fn get_note_by_id(&self, id: i64) -> Result<Note, sqlx::Error>;
    async fn create_note(&self, title: &str, content: &str) -> Result<i64, sqlx::Error>;
    async fn update_note(&self, id: i64, title: &str, content: &str) -> Result<(), sqlx::Error>;
    async fn delete_note(&self, id: i64) -> Result<(), sqlx::Error>;
}

pub struct SqliteNoteRepository {
    pub pool: SqlitePool,
}

impl NoteRepository for SqliteNoteRepository {
    async fn get_all_notes(&self) -> Result<Vec<Note>, sqlx::Error> {
        sqlx::query_as::<_, Note>("SELECT * FROM notes ORDER BY updated_at DESC")
            .fetch_all(&self.pool)
            .await
    }

    async fn get_note_by_id(&self, id: i64) -> Result<Note, sqlx::Error> {
        sqlx::query_as::<_, Note>("SELECT * FROM notes WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    async fn create_note(&self, title: &str, content: &str) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let result = sqlx::query("INSERT INTO notes (title, content, created_at, updated_at, sync_status) VALUES (?, ?, ?, ?, 0)")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        
        Ok(result.last_insert_rowid())
    }

    async fn update_note(&self, id: i64, title: &str, content: &str) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE notes SET title = ?, content = ?, updated_at = ?, sync_status = 0 WHERE id = ?")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }

    async fn delete_note(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM notes WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        
        Ok(())
    }
}