## 16) Extension points and known risks

Extension points:

- attachments table for file attachments.
- sync fields on notes and notebooks.
- meta JSON for per-note metadata.
- OCR languages can be extended via tessdata.

Known risks:

- OCR runs in renderer and can consume CPU.
- Tag tree re-renders fully on tag changes.
- Editor custom blocks depend on DOM state and can be fragile.

----------------------------------------------------------------
