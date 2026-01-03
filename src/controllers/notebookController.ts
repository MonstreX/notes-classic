import type { Notebook } from "../state/types";
import { appStore } from "../state/store";
import { openConfirmDialog, openNotebookDialog } from "../ui/dialogs";
import { createNotebook, deleteNotebook, moveNotebook } from "../services/notes";
import { t } from "../services/i18n";

const getOrderedChildren = (notebooks: Notebook[], parentId: number | null) => {
  const typeFilter = parentId === null ? "stack" : "notebook";
  return notebooks
    .filter((nb) => nb.parentId === parentId && nb.notebookType === typeFilter)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
};

const isDescendant = (notebooks: Notebook[], candidateParentId: number | null, notebookId: number) => {
  if (candidateParentId === null) return false;
  const parentMap = new Map<number, number | null>();
  notebooks.forEach((nb) => parentMap.set(nb.id, nb.parentId));
  let current: number | null = candidateParentId;
  while (current !== null) {
    if (current === notebookId) return true;
    current = parentMap.get(current) ?? null;
  }
  return false;
};

export const createNotebookActions = (fetchData: () => Promise<void>) => ({
  createNotebook: async (parentId: number | null) => {
    const name = await openNotebookDialog({ parentId });
    if (!name) return;
    await createNotebook(name, parentId);
    fetchData();
  },
  deleteNotebook: async (id: number) => {
    const ok = await openConfirmDialog({
      title: t("notebook.delete_title"),
      message: t("notebook.delete_message"),
      confirmLabel: t("attachments.delete"),
      danger: true,
    });
    if (!ok) return;
    await deleteNotebook(id);
    const state = appStore.getState();
    if (state.selectedNotebookId === id) {
      appStore.setState({ selectedNotebookId: null });
    }
    fetchData();
  },
  moveNotebookByDrag: async (activeId: number, overId: number, position: "before" | "after" | "inside") => {
    const state = appStore.getState();
    const activeNotebook = state.notebooks.find((nb) => nb.id === activeId);
    const overNotebook = state.notebooks.find((nb) => nb.id === overId);
    if (!activeNotebook || !overNotebook) return;
    const activeType = activeNotebook.notebookType;
    const overType = overNotebook.notebookType;

    if (activeType === "stack") {
      if (overType !== "stack") return;
      const targetParentId = null;
      const siblings = getOrderedChildren(state.notebooks, null).filter((nb) => nb.id !== activeId);
      let targetIndex = siblings.findIndex((nb) => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after" || position === "inside") targetIndex += 1;
      if (isDescendant(state.notebooks, targetParentId, activeId)) return;
      await moveNotebook(activeId, targetParentId, targetIndex);
      fetchData();
      return;
    }

    if (activeType === "notebook") {
      let targetParentId: number | null = null;
      if (overType === "stack") {
        if (position !== "inside") return;
        targetParentId = overNotebook.id;
        const siblings = getOrderedChildren(state.notebooks, targetParentId).filter((nb) => nb.id !== activeId);
        const targetIndex = siblings.length;
        if (isDescendant(state.notebooks, targetParentId, activeId)) return;
        await moveNotebook(activeId, targetParentId, targetIndex);
        fetchData();
        return;
      }

      targetParentId = overNotebook.parentId;
      if (targetParentId === null) return;
      const targetParent = state.notebooks.find((nb) => nb.id === targetParentId);
      if (!targetParent || targetParent.notebookType !== "stack") return;
      const siblings = getOrderedChildren(state.notebooks, targetParentId).filter((nb) => nb.id !== activeId);
      let targetIndex = siblings.findIndex((nb) => nb.id === overId);
      if (targetIndex < 0) targetIndex = siblings.length;
      if (position === "after" || position === "inside") targetIndex += 1;
      if (isDescendant(state.notebooks, targetParentId, activeId)) return;
      await moveNotebook(activeId, targetParentId, targetIndex);
      fetchData();
    }
  },
});
