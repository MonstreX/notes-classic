use super::SqliteRepository;
use crate::db::models::Notebook;

impl SqliteRepository {
    pub async fn get_notebooks(&self) -> Result<Vec<Notebook>, sqlx::Error> {
        sqlx::query_as::<_, Notebook>(
            "SELECT * FROM notebooks ORDER BY parent_id IS NOT NULL, parent_id, sort_order ASC, name ASC",
        )
            .fetch_all(&self.pool)
            .await
    }
    pub async fn create_notebook(
        &self,
        name: &str,
        parent_id: Option<i64>,
    ) -> Result<i64, sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        let notebook_type = if parent_id.is_some() {
            "notebook"
        } else {
            "stack"
        };
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
    pub async fn rename_notebook(&self, id: i64, name: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notebooks SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn delete_notebook(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM notebooks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn move_notebook(
        &self,
        notebook_id: i64,
        target_parent_id: Option<i64>,
        target_index: usize,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        let current: Option<(Option<i64>, i64, String)> = sqlx::query_as(
            "SELECT parent_id, sort_order, notebook_type FROM notebooks WHERE id = ?",
        )
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
}
