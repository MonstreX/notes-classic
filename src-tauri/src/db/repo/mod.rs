use sqlx::sqlite::SqlitePool;

pub struct SqliteRepository {
    pub pool: SqlitePool,
}

mod attachments;
mod history;
mod notebooks;
mod notes;
mod ocr;
mod tags;
