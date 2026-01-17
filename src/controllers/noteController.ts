import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { openConfirmDialog, openRenameNoteDialog } from "../ui/dialogs";
import { createNote, deleteAllTrashedNotes, deleteNote, getNote, moveNote, restoreAllNotes, restoreNote, trashNote, updateNote } from "../services/notes";
import { loadSelectedNote } from "./noteLoader";
import { t, tCount } from "../services/i18n";
import { getDataDir } from "../services/storage";
import { importAttachmentBytes, readAttachmentBytes } from "../services/attachments";
import { storeNoteFileFromPath } from "../services/noteFiles";
import { toStorageContent } from "../services/content";

const normalizeFilePath = (value: string) => value.replace(/\\/g, "/");

const resolveImagePath = (src: string, dataDir: string) => {
  if (!src) return null;
  const normalizedDataDir = normalizeFilePath(dataDir).replace(/\/$/, "");
  const normalizedSrc = src.trim();
  if (normalizedSrc.startsWith("files/")) {
    return `${normalizedDataDir}/files/${normalizedSrc.slice("files/".length)}`;
  }
  if (normalizedSrc.startsWith("./files/")) {
    return `${normalizedDataDir}/files/${normalizedSrc.slice("./files/".length)}`;
  }
  try {
    const url = new URL(normalizedSrc);
    if (url.hostname === "asset.localhost") {
      const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      return decoded.replace(/^\/\/\?\//, "");
    }
  } catch {
    return null;
  }
  return null;
};

const duplicateContent = async (content: string, newNoteId: number) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/html");
  const dataDir = await getDataDir();

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
  for (const img of images) {
    const src = img.getAttribute("src") || "";
    const localPath = resolveImagePath(src, dataDir);
    if (!localPath) continue;
    try {
      const stored = await storeNoteFileFromPath(localPath);
      img.setAttribute("src", `files/${stored.rel_path}`);
      img.setAttribute("data-en-hash", stored.hash);
    } catch (e) {
      logError("[note] duplicate image failed", e);
    }
  }

  const attachments = Array.from(doc.querySelectorAll<HTMLElement>(".note-attachment"));
  for (const attachment of attachments) {
    if (attachment.dataset.attachmentEmbedded === "1") continue;
    const idRaw = attachment.dataset.attachmentId;
    if (!idRaw) continue;
    const id = Number(idRaw);
    if (!Number.isFinite(id)) continue;
    const name = attachment.dataset.attachmentName || t("attachments.default_name");
    const mime = attachment.dataset.attachmentMime || "application/octet-stream";
    try {
      const bytes = await readAttachmentBytes(id);
      const info = await importAttachmentBytes(newNoteId, name, mime, bytes);
      attachment.dataset.attachmentId = String(info.id);
      attachment.dataset.attachmentName = info.filename;
      attachment.dataset.attachmentSize = String(info.size);
      attachment.dataset.attachmentMime = info.mime;
      const nameEl = attachment.querySelector<HTMLElement>(".note-attachment__name");
      if (nameEl) nameEl.textContent = info.filename;
    } catch (e) {
      logError("[note] duplicate attachment failed", e);
    }
  }

  return doc.body.innerHTML;
};

export const createNoteActions = (fetchData: () => Promise<void>, selectNote: (id: number) => Promise<void>) => {
  const deleteNotesInternal = async (ids: number[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
    if (unique.length === 0) return;
    const prevSelectedId = appStore.getState().selectedNoteId;
    const countLabel = tCount("notes.count", unique.length);
    const state = appStore.getState();
    const inTrash = state.selectedTrash;
    const bypassTrash = !state.deleteToTrash || inTrash;
    const title = unique.length === 1 ? t("note.delete_title_single") : t("note.delete_title_multiple");
    const message = inTrash
      ? t("note.delete_message_trash", { label: countLabel })
      : t("note.delete_message", { label: countLabel });
    const ok = await openConfirmDialog({
      title,
      message,
      confirmLabel: t("attachments.delete"),
      danger: true,
    });
    if (!ok) return;

    if (bypassTrash) {
      for (const id of unique) {
        try {
          await deleteNote(id);
        } catch (e) {
          logError("[note] delete failed", e);
        }
      }
    } else {
      for (const id of unique) {
        try {
          await trashNote(id);
        } catch (e) {
          logError("[note] trash failed", e);
        }
      }
    }

    const idsSet = new Set(unique);
    const remainingNotes = state.notes.filter((note) => !idsSet.has(note.id));
    const remainingSelectedIds = new Set(Array.from(state.selectedNoteIds).filter((id) => !idsSet.has(id)));
    let nextSelectedNoteId = state.selectedNoteId;
    if (nextSelectedNoteId !== null && idsSet.has(nextSelectedNoteId)) {
      nextSelectedNoteId = remainingNotes[0]?.id ?? null;
    }
    if (nextSelectedNoteId !== null) {
      remainingSelectedIds.add(nextSelectedNoteId);
    } else {
      remainingSelectedIds.clear();
    }
    const nextState: Partial<typeof state> = {
      notes: remainingNotes,
      selectedNoteId: nextSelectedNoteId,
      selectedNoteIds: remainingSelectedIds,
    };
    if (nextSelectedNoteId === null) {
      nextState.activeNote = null;
      nextState.title = "";
      nextState.content = "";
    } else {
      nextState.isNoteLoading = true;
    }
    appStore.setState(nextState);
    if (nextSelectedNoteId !== null && nextSelectedNoteId !== prevSelectedId) {
      await loadSelectedNote();
    }
    fetchData();
  };

  return {
    setTitle: (value: string) => appStore.setState({ title: value }),
    setContent: (value: string) => appStore.setState({ content: value }),
    createNote: async () => {
      const state = appStore.getState();
      if (state.selectedTrash || state.selectedTagId !== null) {
        appStore.setState({ selectedTrash: false, selectedTagId: null });
      }
      const id = await createNote(t("app.new_note"), "", state.selectedNotebookId);
      await fetchData();
      await selectNote(id);
    },
    createNoteInNotebook: async (notebookId: number) => {
      appStore.setState({ selectedNotebookId: notebookId, selectedTrash: false, selectedTagId: null });
      const id = await createNote(t("app.new_note"), "", notebookId);
      await fetchData();
      await selectNote(id);
    },
    renameNote: async (id: number) => {
      const state = appStore.getState();
      if (state.selectedTrash) return;
      const entry = state.notes.find((note) => note.id === id);
      if (!entry) return;
      const name = await openRenameNoteDialog({ name: entry.title || t("notes.untitled") });
      if (!name) return;
      if (name === entry.title) return;
      try {
        if (state.selectedNoteId === id && state.activeNote) {
          const updated = toStorageContent(state.content);
          await updateNote(id, name, updated, state.activeNote.notebookId);
          const updatedAt = Date.now() / 1000;
          appStore.setState({
            title: name,
            activeNote: { ...state.activeNote, title: name, updatedAt },
            notes: state.notes.map((note) => note.id === id ? { ...note, title: name, updatedAt } : note),
          });
          return;
        }
        const note = await getNote(id);
        if (!note) return;
        await updateNote(id, name, note.content, note.notebookId);
        const updatedAt = Date.now() / 1000;
        appStore.setState({
          notes: state.notes.map((note) => note.id === id ? { ...note, title: name, updatedAt } : note),
        });
      } catch (e) {
        logError("[note] rename failed", e);
      }
    },
    duplicateNote: async (id: number) => {
      const state = appStore.getState();
      if (state.selectedTrash) return;
      const note = await getNote(id);
      if (!note) return;
      const baseTitle = note.title?.trim() || t("notes.untitled");
      const suffix = t("note.duplicate_suffix");
      const newTitle = `${baseTitle} ${suffix}`.trim();
      try {
        const initialContent = toStorageContent(note.content);
        const newId = await createNote(newTitle, initialContent, note.notebookId ?? null);
        const duplicated = await duplicateContent(note.content, newId);
        await updateNote(newId, newTitle, toStorageContent(duplicated), note.notebookId ?? null);
        await fetchData();
        await selectNote(newId);
      } catch (e) {
        logError("[note] duplicate failed", e);
      }
    },
    deleteNote: async (id: number) => {
      await deleteNotesInternal([id]);
    },
    deleteNotes: deleteNotesInternal,
    restoreNote: async (id: number) => {
      try {
        await restoreNote(id);
      } catch (e) {
        logError("[note] restore failed", e);
        return;
      }
      const state = appStore.getState();
      if (state.selectedTrash) {
        const nextNotes = state.notes.filter((note) => note.id !== id);
        const nextSelected = nextNotes[0]?.id ?? null;
        appStore.setState({ notes: nextNotes, selectedNoteId: nextSelected });
      }
      fetchData();
    },
    restoreNotes: async (ids: number[]) => {
      const unique = Array.from(new Set(ids)).filter((id) => Number.isFinite(id));
      if (unique.length === 0) return;
      for (const id of unique) {
        try {
          await restoreNote(id);
        } catch (e) {
          logError("[note] restore failed", e);
        }
      }
      const state = appStore.getState();
      if (state.selectedTrash) {
        const idsSet = new Set(unique);
        const nextNotes = state.notes.filter((note) => !idsSet.has(note.id));
        const nextSelected = nextNotes[0]?.id ?? null;
        appStore.setState({ notes: nextNotes, selectedNoteId: nextSelected, selectedNoteIds: nextSelected ? new Set([nextSelected]) : new Set() });
      }
      fetchData();
    },
    restoreAllTrash: async () => {
      try {
        await restoreAllNotes();
      } catch (e) {
        logError("[note] restore all failed", e);
        return;
      }
      if (appStore.getState().selectedTrash) {
        appStore.setState({ notes: [], selectedNoteId: null });
      }
      fetchData();
    },
    emptyTrash: async () => {
      const state = appStore.getState();
      if (state.trashedCount === 0) return;
      const countLabel = tCount("notes.count", state.trashedCount);
      const ok = await openConfirmDialog({
        title: t("trash.empty_title"),
        message: t("trash.empty_message", { label: countLabel }),
        confirmLabel: t("attachments.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAllTrashedNotes();
      } catch (e) {
        logError("[note] empty trash failed", e);
        return;
      }
      if (state.selectedTrash) {
        appStore.setState({ notes: [], selectedNoteId: null, selectedNoteIds: new Set() });
      }
      fetchData();
    },
    moveNoteToNotebook: async (noteId: number, notebookId: number | null) => {
      await moveNote(noteId, notebookId);
      const state = appStore.getState();
      if (state.selectedNotebookId !== null && notebookId !== state.selectedNotebookId) {
        if (state.selectedNoteId === noteId) {
          appStore.setState({ selectedNoteId: null });
        }
      }
      fetchData();
    },
    moveNotesToNotebook: async (noteIds: number[], notebookId: number | null) => {
      const unique = Array.from(new Set(noteIds)).filter((id) => Number.isFinite(id));
      for (const id of unique) {
        await moveNote(id, notebookId);
      }
      fetchData();
    },
  };
};
