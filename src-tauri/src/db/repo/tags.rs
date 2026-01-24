use super::SqliteRepository;
use crate::db::models::Tag;

impl SqliteRepository {
    pub async fn get_tags(&self) -> Result<Vec<Tag>, sqlx::Error> {
        sqlx::query_as::<_, Tag>(
            "SELECT * FROM tags ORDER BY parent_id IS NOT NULL, parent_id, name",
        )
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
    pub async fn rename_tag(&self, tag_id: i64, name: &str) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE tags SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name)
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
