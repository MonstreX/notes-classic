# Schema cleanup (v2)

This app now uses schema versioning (table `schema_version`) and a leaner schema.

Removed fields:
- notes.sync_status
- notes.remote_id
- notes.external_id
- notes.meta
- notes.content_hash
- notes.content_size
- notebooks.external_id
- tags.external_id

Removed tables:
- attachments

Reason:
- These fields/tables were placeholders for sync/attachments and were not used
  by the current app logic. Keeping them added noise and maintenance cost.

Future reintroduction:
- If/when sync and attachments are added back, reintroduce them via a new
  migration (bump schema version and document the new fields).
