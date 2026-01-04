## 14) Error handling and logging

Frontend:

- logError is used for structured console errors.
- Many operations guard against stale state.
- OCR errors are logged and retried.

Backend:

- Errors are returned as strings in Result.
- Storage errors show a dialog and abort startup.

----------------------------------------------------------------
