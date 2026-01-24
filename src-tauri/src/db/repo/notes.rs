use super::SqliteRepository;
use crate::db::models::{Note, NoteCountItem, NoteCounts, NoteLinkItem, NoteListItem};
use crate::db::utils::{extract_attachment_ids, extract_note_files, strip_html};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

impl SqliteRepository {
    async fn upsert_note_text_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        title: &str,
        content: &str,
    ) -> Result<(), sqlx::Error> {
        let plain = strip_html(content);
        sqlx::query(
            "INSERT INTO notes_text (note_id, title, plain_text)
             VALUES (?, ?, ?)
             ON CONFLICT(note_id) DO UPDATE SET title = excluded.title, plain_text = excluded.plain_text",
        )
        .bind(note_id)
        .bind(title)
        .bind(plain)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }
    async fn sync_note_files_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        content: &str,
    ) -> Result<Vec<(i64, String)>, sqlx::Error> {
        let files = extract_note_files(content);
        sqlx::query("DELETE FROM note_files WHERE note_id = ?")
            .bind(note_id)
            .execute(&mut **tx)
            .await?;
        let mut mapped = Vec::new();
        for file_path in files {
            sqlx::query(
                "INSERT INTO ocr_files (file_path) VALUES (?) ON CONFLICT(file_path) DO NOTHING",
            )
            .bind(&file_path)
            .execute(&mut **tx)
            .await?;
            let (file_id,): (i64,) = sqlx::query_as("SELECT id FROM ocr_files WHERE file_path = ?")
                .bind(&file_path)
                .fetch_one(&mut **tx)
                .await?;
            sqlx::query(
                "INSERT INTO note_files (note_id, file_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .bind(note_id)
            .bind(file_id)
            .execute(&mut **tx)
            .await?;
            mapped.push((file_id, file_path));
        }
        Ok(mapped)
    }
    async fn cleanup_orphan_note_files_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ) -> Result<Vec<String>, sqlx::Error> {
        let orphan_files: Vec<(i64, String)> = sqlx::query_as(
            "SELECT f.id, f.file_path
             FROM ocr_files f
             LEFT JOIN note_files nf ON nf.file_id = f.id
             WHERE nf.file_id IS NULL",
        )
        .fetch_all(&mut **tx)
        .await?;
        for (id, _) in &orphan_files {
            sqlx::query("DELETE FROM ocr_files WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
        Ok(orphan_files.into_iter().map(|(_, path)| path).collect())
    }
    async fn cleanup_note_attachments_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        note_id: i64,
        keep_ids: &HashSet<i64>,
    ) -> Result<Vec<String>, sqlx::Error> {
        let existing: Vec<(i64, Option<String>)> =
            sqlx::query_as("SELECT id, local_path FROM attachments WHERE note_id = ?")
                .bind(note_id)
                .fetch_all(&mut **tx)
                .await?;
        let mut removed = Vec::new();
        for (id, path) in existing {
            if keep_ids.contains(&id) {
                continue;
            }
            sqlx::query("DELETE FROM attachments WHERE id = ?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
            if let Some(path) = path {
                if !path.is_empty() {
                    removed.push(path);
                }
            }
        }
        Ok(removed)
    }
    pub(crate) async fn sync_note_files(
        &self,
        note_id: i64,
        content: &str,
    ) -> Result<Vec<(i64, String)>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let mapped = self.sync_note_files_tx(&mut tx, note_id, content).await?;
        tx.commit().await?;
        Ok(mapped)
    }
    pub async fn get_all_notes(
        &self,
        notebook_id: Option<i64>,
    ) -> Result<Vec<NoteListItem>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, NoteListItem>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                )
                SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match FROM notes
                WHERE deleted_at IS NULL
                  AND notebook_id IN (SELECT id FROM descendant_notebooks)
                ORDER BY updated_at DESC, created_at DESC, id DESC",
            )
            .bind(id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match
                 FROM notes
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC, created_at DESC, id DESC",
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
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL")
            .fetch_one(&self.pool)
            .await?;
        let trashed: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL")
                .fetch_one(&self.pool)
                .await?;
        let per_notebook = sqlx::query_as::<_, NoteCountItem>(
            "SELECT notebook_id, COUNT(*) AS count
             FROM notes
             WHERE notebook_id IS NOT NULL AND deleted_at IS NULL
             GROUP BY notebook_id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(NoteCounts {
            total: total.0,
            trashed: trashed.0,
            per_notebook,
        })
    }
    pub async fn create_note(
        &self,
        title: &str,
        content: &str,
        notebook_id: Option<i64>,
        data_dir: &Path,
    ) -> Result<i64, sqlx::Error> {
        let _ = data_dir;
        let now = chrono::Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query("INSERT INTO notes (title, content, created_at, updated_at, notebook_id) VALUES (?, ?, ?, ?, ?)")
            .bind(title)
            .bind(content)
            .bind(now)
            .bind(now)
            .bind(notebook_id)
            .execute(&mut *tx)
            .await?;
        let id = result.last_insert_rowid();
        self.upsert_note_text_tx(&mut tx, id, title, content)
            .await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        tx.commit().await?;
        Ok(id)
    }
    pub async fn search_notes_by_title(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<NoteLinkItem>, sqlx::Error> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let like = format!("%{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));
        sqlx::query_as::<_, NoteLinkItem>(
            "SELECT id, title, notebook_id, external_id
             FROM notes
             WHERE deleted_at IS NULL AND LOWER(title) LIKE LOWER(?) ESCAPE '\\'
             ORDER BY updated_at DESC
             LIMIT ?",
        )
        .bind(like)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }
    pub async fn get_note_id_by_external_id(
        &self,
        external_id: &str,
    ) -> Result<Option<i64>, sqlx::Error> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM notes WHERE external_id = ? AND deleted_at IS NULL LIMIT 1",
        )
        .bind(external_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|value| value.0))
    }
    pub async fn set_note_external_id(
        &self,
        note_id: i64,
        external_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET external_id = ? WHERE id = ?")
            .bind(external_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn update_note_notebook(
        &self,
        note_id: i64,
        notebook_id: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE notes SET notebook_id = ? WHERE id = ?")
            .bind(notebook_id)
            .bind(note_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn update_note(
        &self,
        id: i64,
        title: &str,
        content: &str,
        notebook_id: Option<i64>,
        data_dir: &Path,
    ) -> Result<(), sqlx::Error> {
        let attachment_ids = extract_attachment_ids(content);
        let now = chrono::Utc::now().timestamp();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE notes SET title = ?, content = ?, updated_at = ?, notebook_id = ? WHERE id = ?",
        )
        .bind(title)
        .bind(content)
        .bind(now)
        .bind(notebook_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        self.upsert_note_text_tx(&mut tx, id, title, content)
            .await?;
        let _ = self.sync_note_files_tx(&mut tx, id, content).await?;
        let removed_attachments = self
            .cleanup_note_attachments_tx(&mut tx, id, &attachment_ids)
            .await?;
        let orphan_files = self.cleanup_orphan_note_files_tx(&mut tx).await?;
        tx.commit().await?;
        for path in removed_attachments {
            let full_path = data_dir.join(path);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        for rel in orphan_files {
            let full_path = data_dir.join("files").join(&rel);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        Ok(())
    }
    pub async fn search_notes(
        &self,
        query: &str,
        notebook_id: Option<i64>,
    ) -> Result<Vec<NoteListItem>, sqlx::Error> {
        if let Some(id) = notebook_id {
            sqlx::query_as::<_, NoteListItem>(
                "WITH RECURSIVE descendant_notebooks(id) AS (
                    SELECT id FROM notebooks WHERE id = ?
                    UNION ALL
                    SELECT n.id FROM notebooks n
                    JOIN descendant_notebooks dn ON n.parent_id = dn.id
                ),
                text_matches AS (
                    SELECT n.id, n.title,
                           snippet(notes_fts, 1, '', '', '...', 20) AS content,
                           n.updated_at, n.notebook_id,
                           0 AS ocr_match
                    FROM notes_fts
                    JOIN notes n ON n.id = notes_fts.rowid
                    WHERE notes_fts MATCH ?
                      AND n.deleted_at IS NULL
                      AND n.notebook_id IN (SELECT id FROM descendant_notebooks)
                ),
                ocr_matches AS (
                    SELECT n.id, n.title,
                           '' AS content,
                           n.updated_at, n.notebook_id,
                           1 AS ocr_match
                    FROM ocr_fts
                    JOIN note_files nf ON nf.file_id = ocr_fts.rowid
                    JOIN notes n ON n.id = nf.note_id
                    WHERE ocr_fts MATCH ?
                      AND n.deleted_at IS NULL
                      AND n.notebook_id IN (SELECT id FROM descendant_notebooks)
                )
                SELECT id, title,
                       MAX(content) AS content,
                       updated_at, notebook_id,
                       MAX(ocr_match) AS ocr_match
                FROM (
                    SELECT * FROM text_matches
                    UNION ALL
                    SELECT * FROM ocr_matches
                )
                GROUP BY id, title, updated_at, notebook_id
                ORDER BY updated_at DESC, id DESC",
            )
            .bind(id)
            .bind(query)
            .bind(query)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, NoteListItem>(
                "WITH text_matches AS (
                    SELECT n.id, n.title,
                           snippet(notes_fts, 1, '', '', '...', 20) AS content,
                           n.updated_at, n.notebook_id,
                           0 AS ocr_match
                    FROM notes_fts
                    JOIN notes n ON n.id = notes_fts.rowid
                    WHERE notes_fts MATCH ?
                      AND n.deleted_at IS NULL
                ),
                ocr_matches AS (
                    SELECT n.id, n.title,
                           '' AS content,
                           n.updated_at, n.notebook_id,
                           1 AS ocr_match
                    FROM ocr_fts
                    JOIN note_files nf ON nf.file_id = ocr_fts.rowid
                    JOIN notes n ON n.id = nf.note_id
                    WHERE ocr_fts MATCH ?
                      AND n.deleted_at IS NULL
                )
                SELECT id, title,
                       MAX(content) AS content,
                       updated_at, notebook_id,
                       MAX(ocr_match) AS ocr_match
                FROM (
                    SELECT * FROM text_matches
                    UNION ALL
                    SELECT * FROM ocr_matches
                )
                GROUP BY id, title, updated_at, notebook_id
                ORDER BY updated_at DESC, id DESC",
            )
            .bind(query)
            .bind(query)
            .fetch_all(&self.pool)
            .await
        }
    }
    pub async fn get_notes_by_tag(&self, tag_id: i64) -> Result<Vec<NoteListItem>, sqlx::Error> {
        sqlx::query_as::<_, NoteListItem>(
            "SELECT n.id, n.title, n.content, n.updated_at, n.notebook_id, 0 AS ocr_match
             FROM notes n
             JOIN note_tags nt ON nt.note_id = n.id
             WHERE nt.tag_id = ?
               AND n.deleted_at IS NULL
             ORDER BY n.updated_at DESC, n.created_at DESC, n.id DESC",
        )
        .bind(tag_id)
        .fetch_all(&self.pool)
        .await
    }
    pub async fn get_trashed_notes(&self) -> Result<Vec<NoteListItem>, sqlx::Error> {
        sqlx::query_as::<_, NoteListItem>(
            "SELECT id, title, substr(content, 1, 4000) AS content, updated_at, notebook_id, 0 AS ocr_match
             FROM notes
             WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC, updated_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await
    }
    pub async fn delete_note(&self, id: i64, data_dir: &Path) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let attachment_paths: Vec<(Option<String>,)> =
            sqlx::query_as("SELECT local_path FROM attachments WHERE note_id = ?")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        sqlx::query("DELETE FROM notes WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM notes_text WHERE note_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let orphan_files = self.cleanup_orphan_note_files_tx(&mut tx).await?;
        tx.commit().await?;
        for (path_opt,) in attachment_paths {
            let Some(path) = path_opt else { continue };
            if path.is_empty() {
                continue;
            }
            let full_path = data_dir.join(path);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        for rel in orphan_files {
            let full_path = data_dir.join("files").join(&rel);
            if full_path.exists() {
                let _ = fs::remove_file(&full_path);
            }
            if let Some(parent) = full_path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
        Ok(())
    }
    pub async fn trash_note(&self, id: i64) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query(
            "UPDATE notes
             SET deleted_at = ?,
                 deleted_from_notebook_id = notebook_id,
                 notebook_id = NULL
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn restore_note(&self, id: i64) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let row: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT deleted_from_notebook_id FROM notes WHERE id = ?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let target_notebook_id = if let Some((Some(notebook_id),)) = row {
            let exists: Option<(i64,)> = sqlx::query_as("SELECT id FROM notebooks WHERE id = ?")
                .bind(notebook_id)
                .fetch_optional(&mut *tx)
                .await?;
            if exists.is_some() {
                Some(notebook_id)
            } else {
                None
            }
        } else {
            None
        };

        sqlx::query(
            "UPDATE notes
             SET deleted_at = NULL,
                 deleted_from_notebook_id = NULL,
                 notebook_id = ?
             WHERE id = ?",
        )
        .bind(target_notebook_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn restore_all_notes(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE notes
             SET notebook_id = (
                 SELECT id FROM notebooks WHERE id = notes.deleted_from_notebook_id
             ),
                 deleted_at = NULL,
                 deleted_from_notebook_id = NULL
             WHERE deleted_at IS NOT NULL",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    pub async fn delete_all_trashed_notes(&self, data_dir: &Path) -> Result<i64, sqlx::Error> {
        let ids: Vec<(i64,)> = sqlx::query_as("SELECT id FROM notes WHERE deleted_at IS NOT NULL")
            .fetch_all(&self.pool)
            .await?;
        let mut deleted = 0;
        for (id,) in ids {
            self.delete_note(id, data_dir).await?;
            deleted += 1;
        }
        Ok(deleted)
    }
}
