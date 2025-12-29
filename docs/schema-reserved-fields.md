# Reserved schema fields

The following columns are kept for future sync/metadata features but are not used
by the current app logic:

- notes.sync_status
- notes.remote_id
- notes.external_id
- notes.meta
- notes.content_hash
- notes.content_size
- notebooks.external_id
- tags.external_id

The `attachments` table is used for file attachments. It stores file metadata
and a local_path that points to files under data/files/attachments.
