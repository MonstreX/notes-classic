use super::SqliteRepository;
use crate::db::models::NoteHistoryItem;

impl SqliteRepository {
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
}
