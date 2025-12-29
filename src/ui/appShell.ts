import { openNoteContextMenu, openNotebookContextMenu, openTagContextMenu } from "./contextMenu";
import { mountEditor, type EditorInstance } from "./editor";
import { mountMetaBar } from "./metaBar";
import { mountNotesList, type NotesListHandlers, type NotesListInstance } from "./notesList";
import { buildMenuNodes } from "./menuBuilder";
import { mountSearchModal } from "./searchModal";
import { mountSidebar, type SidebarHandlers, type SidebarInstance } from "./sidebar";
import { mountTagsBar } from "./tagsBar";
import { createEditorScheduler } from "./editorScheduler";
import { createAppLayout } from "./appLayout";
import { createAppRenderer } from "./appRenderer";
import { actions, initApp } from "../controllers/appController";
import { startOcrQueue } from "../services/ocr";
import { appStore } from "../state/store";

export const mountApp = (root: HTMLElement) => {
  let openSearchModal = () => {};
  const layout = createAppLayout(root, {
    onSearch: () => openSearchModal(),
    onNewNote: () => actions.createNote(),
  });

  layout.titleInput.addEventListener("input", () => {
    if (appStore.getState().selectedNoteId) {
      actions.setTitle(layout.titleInput.value);
    }
  });

  const metaBar = mountMetaBar(layout.editorShell);
  const tagsBar = mountTagsBar(layout.editorShell, {
    onAddTag: actions.addTagToNote,
    onRemoveTag: actions.removeTagFromNote,
  });

  const searchModal = mountSearchModal(layout.editorPane, {
    onOpenNote: (noteId, notebookId) => {
      const state = appStore.getState();
      if (notebookId !== null) {
        const notebook = state.notebooks.find((nb) => nb.id === notebookId);
        if (notebook?.parentId) {
          const nextExpanded = new Set(state.expandedNotebooks);
          nextExpanded.add(notebook.parentId);
          appStore.setState({ expandedNotebooks: nextExpanded });
        }
      }
      actions.selectNotebook(notebookId);
      actions.selectNote(noteId);
    },
  });
  openSearchModal = () => searchModal.open();

  const sidebarHandlers: SidebarHandlers = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onSelectTag: (id) => actions.selectTag(id),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onToggleTag: (id) => actions.toggleTag(id),
    onCreateNotebook: (parentId) => actions.createNotebook(parentId),
    onCreateTag: (parentId) => actions.createTag(parentId),
    onToggleTagsSection: () => actions.toggleTagsSection(),
    onCreateNoteInNotebook: (id) => actions.createNoteInNotebook(id),
    onDeleteNotebook: (id) => actions.deleteNotebook(id),
    onTagContextMenu: (event, id) => {
      event.preventDefault();
      openTagContextMenu({
        x: event.clientX,
        y: event.clientY,
        tagId: id,
        onDelete: actions.deleteTag,
      });
    },
    onNotebookContextMenu: (event, id) => {
      event.preventDefault();
      openNotebookContextMenu({
        x: event.clientX,
        y: event.clientY,
        notebookId: id,
        onDelete: actions.deleteNotebook,
      });
    },
    onMoveTag: (tagId, parentId) => actions.moveTag(tagId, parentId),
    onMoveNotebook: (activeId, overId, position) => actions.moveNotebookByDrag(activeId, overId, position),
  };

  const notesListHandlers: NotesListHandlers = {
    onSelectNote: (id) => actions.selectNote(id),
    onDeleteNote: (id) => actions.deleteNote(id),
    onSelectSort: (sortBy, sortDir) => actions.setNotesSort(sortBy, sortDir),
    onToggleView: () => {
      const state = appStore.getState();
      const next = state.notesListView === "compact" ? "detailed" : "compact";
      actions.setNotesListView(next);
    },
    onFilterClick: () => {},
    onNoteContextMenu: (event, id) => {
      event.preventDefault();
      const state = appStore.getState();
      const nodes = buildMenuNodes(null, state);
      openNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: id,
        nodes,
        onDelete: actions.deleteNote,
        onMove: actions.moveNoteToNotebook,
      });
    },
    onMoveNote: (noteId, notebookId) => actions.moveNoteToNotebook(noteId, notebookId),
  };

  const sidebarInstance: SidebarInstance = mountSidebar(layout.sidebarHost, sidebarHandlers);
  const notesListInstance: NotesListInstance = mountNotesList(layout.listHost, notesListHandlers);

  let editorFocused = false;
  const editorInstance: EditorInstance = mountEditor(layout.editorHost, {
    content: "",
    onChange: actions.setContent,
    onFocus: () => {
      editorFocused = true;
    },
    onBlur: () => {
      editorFocused = false;
    },
    getNoteId: () => appStore.getState().selectedNoteId,
  });

  const editorScheduler = createEditorScheduler({
    editor: editorInstance,
    getSelectedNoteId: () => appStore.getState().selectedNoteId,
  });

  const renderer = createAppRenderer({
    layout,
    sidebar: sidebarInstance,
    notesList: notesListInstance,
    metaBar,
    tagsBar,
    editorScheduler,
    isEditorFocused: () => editorFocused,
  });

  let isResizingSidebar = false;
  let isResizingList = false;

  const handleMouseMove = (event: MouseEvent) => {
    const state = appStore.getState();
    if (isResizingSidebar) {
      actions.setSidebarWidth(Math.max(150, Math.min(450, event.clientX)));
    } else if (isResizingList) {
      actions.setListWidth(Math.max(200, Math.min(600, event.clientX - state.sidebarWidth)));
    }
  };

  const handleMouseUp = () => {
    isResizingSidebar = false;
    isResizingList = false;
  };

  layout.sidebarResize.addEventListener("mousedown", () => {
    isResizingSidebar = true;
  });
  layout.listResize.addEventListener("mousedown", () => {
    isResizingList = true;
  });
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);

  const render = () => renderer.render(appStore.getState());
  const unsubscribe = appStore.subscribe(render);
  render();

  let cleanupInit: (() => void) | undefined;
  let cleanupOcr: (() => void) | undefined;
  initApp().then((cleanup) => {
    cleanupInit = cleanup;
    cleanupOcr = startOcrQueue();
  });

  return () => {
    unsubscribe();
    cleanupInit?.();
    cleanupOcr?.();
    sidebarInstance.destroy();
    notesListInstance.destroy();
    editorInstance.destroy();
    editorScheduler.reset();
    searchModal.destroy();
    metaBar.destroy();
    tagsBar.destroy();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    layout.destroy();
  };
};
