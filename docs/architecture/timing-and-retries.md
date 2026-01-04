## 18) Timing constants and retries

The code base uses a small set of timing constants that affect UX:

- Drag hold delay: `src/ui/dragConfig.ts` -> `DRAG_HOLD_MS`
- Drag distance threshold: `src/ui/dragConfig.ts` -> `DRAG_START_PX`
- Editor update scheduling: `src/ui/editorScheduler.ts` uses setTimeout(0)
- Autosave debounce: `src/controllers/appController.ts` -> 1000 ms
- Settings debounce: `src/services/settings.ts` -> 200 ms
- OCR queue:
  - `src/services/ocr.ts` -> `BATCH_SIZE`, `IDLE_DELAY_MS`, `RETRY_DELAY_MS`
  - worker timeout uses `withTimeout` (30s start, 60s recognize)

Retry strategy:

- OCR uses `attempts_left` in `ocr_files` (default 3).
- Each failure decrements attempts_left.
- Files with attempts_left == 0 are skipped by the queue.

----------------------------------------------------------------

End of document.
