import type { Tag } from "../state/types";
import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { addNoteTag, createTag as createTagService, deleteTag as deleteTagService, getNoteTags, getTags, removeNoteTag, renameTag as renameTagService, updateTagParent } from "../services/tags";
import { openConfirmDialog, openRenameTagDialog, openTagDialog } from "../ui/dialogs";
import { t } from "../services/i18n";

const normalizeTagName = (value: string) => value.trim();

const findTagByName = (tags: Tag[], name: string) => {
  const lower = name.toLowerCase();
  return tags.find((tag) => tag.name.toLowerCase() === lower) ?? null;
};

const isTagDescendant = (tags: Tag[], candidateParentId: number | null, tagId: number) => {
  if (candidateParentId === null) return false;
  const parentMap = new Map<number, number | null>();
  tags.forEach((tag) => parentMap.set(tag.id, tag.parentId));
  let current: number | null = candidateParentId;
  while (current !== null) {
    if (current === tagId) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
};

export const createTagActions = (fetchData: () => Promise<void>) => ({
  addTagToNote: async (name: string) => {
    const state = appStore.getState();
    const noteId = state.selectedNoteId;
    if (!noteId) return;
    const normalized = normalizeTagName(name);
    if (!normalized) return;
    const existing = findTagByName(state.tags, normalized);
    let tagId = existing?.id;
    if (!tagId) {
      tagId = await createTagService(normalized, null);
      appStore.setState({ tags: [...state.tags, { id: tagId, name: normalized, parentId: null }] });
    }
    await addNoteTag(noteId, tagId);
    const updated = await getNoteTags(noteId);
    appStore.setState({ noteTags: updated });
  },
  addTagToNoteById: async (noteId: number, tagId: number) => {
    try {
      await addNoteTag(noteId, tagId);
      const state = appStore.getState();
      if (state.selectedNoteId === noteId) {
        const updated = await getNoteTags(noteId);
        appStore.setState({ noteTags: updated });
      }
    } catch (e) {
      logError("[tag] add failed", e);
    }
  },
  createTag: async (parentId: number | null) => {
    const name = await openTagDialog({ parentId });
    if (!name) return;
    const normalized = normalizeTagName(name);
    if (!normalized) return;
    const id = await createTagService(normalized, parentId);
    const state = appStore.getState();
    appStore.setState({ tags: [...state.tags, { id, name: normalized, parentId }] });
    if (parentId !== null) {
      const next = new Set(state.expandedTags);
      next.add(parentId);
      appStore.setState({ expandedTags: next });
    }
  },
  deleteTag: async (id: number) => {
    const ok = await openConfirmDialog({
      title: t("tag.delete_title"),
      message: t("tag.delete_message"),
      confirmLabel: t("attachments.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTagService(id);
      const tags = await getTags();
      const state = appStore.getState();
      const nextSelectedTagId = state.selectedTagId === id ? null : state.selectedTagId;
      const nextExpandedTags = new Set(
        Array.from(state.expandedTags).filter((tagId) => tagId !== id)
      );
      appStore.setState({ tags, selectedTagId: nextSelectedTagId, expandedTags: nextExpandedTags });
      if (state.selectedTagId === id) {
        fetchData();
      }
    } catch (e) {
      logError("[tag] delete failed", e);
    }
  },
  renameTag: async (id: number) => {
    const state = appStore.getState();
    const tag = state.tags.find((entry) => entry.id === id);
    if (!tag) return;
    const name = await openRenameTagDialog({ name: tag.name });
    if (!name) return;
    const normalized = normalizeTagName(name);
    if (!normalized || normalized === tag.name) return;
    try {
      await renameTagService(id, normalized);
      const tags = await getTags();
      appStore.setState({ tags });
      const selected = appStore.getState().selectedTagId;
      if (selected === id) {
        fetchData();
      }
    } catch (e) {
      logError("[tag] rename failed", e);
    }
  },
  moveTag: async (tagId: number, parentId: number | null) => {
    const state = appStore.getState();
    if (tagId === parentId) return;
    if (isTagDescendant(state.tags, parentId, tagId)) return;
    await updateTagParent(tagId, parentId);
    const tags = await getTags();
    const nextExpandedTags = new Set(state.expandedTags);
    if (parentId !== null) nextExpandedTags.add(parentId);
    appStore.setState({ tags, expandedTags: nextExpandedTags });
  },
  removeTagFromNote: async (tagId: number) => {
    const state = appStore.getState();
    const noteId = state.selectedNoteId;
    if (!noteId) return;
    try {
      await removeNoteTag(noteId, tagId);
      const updated = await getNoteTags(noteId);
      appStore.setState({ noteTags: updated });
    } catch (e) {
      logError("[tag] remove failed", e);
    }
  },
  addTagToNotes: async (noteIds: number[], tagId: number) => {
    const unique = Array.from(new Set(noteIds)).filter((id) => Number.isFinite(id));
    for (const id of unique) {
      try {
        await addNoteTag(id, tagId);
      } catch (e) {
        logError("[tag] add failed", e);
      }
    }
    const state = appStore.getState();
    if (state.selectedNoteId && unique.includes(state.selectedNoteId)) {
      const updated = await getNoteTags(state.selectedNoteId);
      appStore.setState({ noteTags: updated });
    }
  },
});
