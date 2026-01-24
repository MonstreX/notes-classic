use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub parent_id: Option<i64>,
    pub notebook_type: String,
    pub sort_order: i64,
    pub external_id: Option<String>,
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
    pub external_id: Option<String>,
    pub meta: Option<String>,
    pub content_hash: Option<String>,
    pub content_size: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteListItem {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub updated_at: i64,
    pub notebook_id: Option<i64>,
    pub ocr_match: bool,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkItem {
    pub id: i64,
    pub title: String,
    pub notebook_id: Option<i64>,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i64,
    pub note_id: i64,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub local_path: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrFileItem {
    pub file_id: i64,
    pub file_path: String,
    pub mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrStats {
    pub total: i64,
    pub done: i64,
    pub pending: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteCountItem {
    pub notebook_id: i64,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteCounts {
    pub trashed: i64,
    pub total: i64,
    pub per_notebook: Vec<NoteCountItem>,
}

#[derive(Debug, Serialize, Deserialize, FromRow, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryItem {
    pub id: i64,
    pub note_id: i64,
    pub opened_at: i64,
    pub note_title: String,
    pub notebook_id: Option<i64>,
    pub notebook_name: Option<String>,
    pub stack_id: Option<i64>,
    pub stack_name: Option<String>,
}
