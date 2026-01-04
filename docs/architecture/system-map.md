## 2) System map

The app is a layered system:

- UI layer (src/ui) renders DOM and handles user input.
- Controller layer (src/controllers) performs orchestration.
- State layer (src/state) stores in-memory state and subscriptions.
- Service layer (src/services) talks to backend and normalizes data.
- Backend layer (src-tauri/src) runs SQLite and filesystem access.
- Storage layer (data/, settings/) holds persistence.

The top level data flow is:

UI -> Controller -> Services -> Backend -> SQLite
SQLite -> Backend -> Services -> Controller -> UI

----------------------------------------------------------------
