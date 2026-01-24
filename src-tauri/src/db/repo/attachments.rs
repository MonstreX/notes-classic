use super::SqliteRepository;
use crate::db::models::Attachment;

impl SqliteRepository {
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
}
