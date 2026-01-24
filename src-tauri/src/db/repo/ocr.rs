use super::SqliteRepository;
use crate::db::models::{OcrFileItem, OcrStats};
use crate::db::utils::OCR_IMAGE_FILTER;
use std::path::Path;

impl SqliteRepository {
    async fn backfill_note_files(&self) -> Result<(), sqlx::Error> {
        let notes: Vec<(i64, String)> = sqlx::query_as("SELECT id, content FROM notes")
            .fetch_all(&self.pool)
            .await?;
        for (note_id, content) in notes {
            self.sync_note_files(note_id, &content).await?;
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
        if self.needs_note_files_backfill().await? {
            self.backfill_note_files().await?;
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
        if self.needs_note_files_backfill().await? {
            self.backfill_note_files().await?;
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
}
