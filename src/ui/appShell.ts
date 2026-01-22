import { listen } from "@tauri-apps/api/event";
import { openNoteContextMenu, openNotebookContextMenu, openTagContextMenu, openTrashContextMenu, openTrashNoteContextMenu, openTrashNotesContextMenu, openNotesContextMenu, openNoteMetaMenu } from "./contextMenu";
import { mountEditor, type EditorInstance } from "./editor";
import { mountMetaBar } from "./metaBar";
import { mountNotesList, type NotesListHandlers, type NotesListInstance } from "./notesList";
import { buildMenuNodes } from "./menuBuilder";
import { mountSearchModal } from "./searchModal";
import { mountSettingsModal } from "./settingsModal";
import { mountEvernoteImportModal } from "./evernoteImportModal";
import { mountObsidianImportModal } from "./obsidianImportModal";
import { mountHtmlImportModal } from "./htmlImportModal";
import { mountTextImportModal } from "./textImportModal";
import { mountNotesClassicImportModal } from "./notesClassicImportModal";
import { mountHistoryModal } from "./historyModal";
import { mountSidebar, type SidebarHandlers, type SidebarInstance } from "./sidebar";
import { mountTagsBar } from "./tagsBar";
import { mountExportModal, mountExportModalWith } from "./exportModal";
import { runObsidianExport } from "../services/obsidianExport";
import { runHtmlExport } from "../services/htmlExport";
import { runTextExport } from "../services/textExport";
import { exportNoteHtmlOneFile, exportNotesHtmlOneFile } from "../services/noteHtmlExport";
import { exportNotePdfNative, exportNotesPdfNative } from "../services/pdfNativeExport";
import { getPdfAvailability, installPdfResources } from "../services/pdfResources";
import { createEditorScheduler } from "./editorScheduler";
import { createAppLayout } from "./appLayout";
import { createAppRenderer } from "./appRenderer";
import { actions, initApp } from "../controllers/appController";
import { startOcrQueue } from "../services/ocr";
import { appStore } from "../state/store";
import { openExportResultDialog, openResourceInstallDialog } from "./dialogs";
import { openRestartDialog } from "./importFlow";
import { t } from "../services/i18n";
import type { ExportResult } from "../services/exportUtils";

export const mountApp = (root: HTMLElement) => {
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const showExportResult = (result: ExportResult | null) => {
    if (!result) return;
    const rows = [
      `<div class="import-summary__row"><span>${t("export_result.total")}</span><span>${result.total}</span></div>`,
      `<div class="import-summary__row"><span>${t("export_result.success")}</span><span>${result.success}</span></div>`,
      `<div class="import-summary__row"><span>${t("export_result.failed")}</span><span>${result.failed}</span></div>`,
    ];
    if (result.path) {
      rows.push(`<div class="import-summary__row"><span>${t("export_result.path")}</span><span>${escapeHtml(result.path)}</span></div>`);
    } else if (result.folder) {
      rows.push(`<div class="import-summary__row"><span>${t("export_result.folder")}</span><span>${escapeHtml(result.folder)}</span></div>`);
    }
    let message = rows.join("");
    if (result.errors.length) {
      const errors = result.errors.map((err) =>
        `<div class="import-error-list__item">${escapeHtml(err)}</div>`
      ).join("");
      message += `
        <div class="import-error-summary">${t("export_result.errors")}</div>
        <div class="import-error-list">${errors}</div>
      `;
    }
    openExportResultDialog({
      title: result.failed > 0 ? t("export_result.title_error") : t("export_result.title_success"),
      message,
    });
  };

  const ensurePdfResources = async () => {
    const status = await getPdfAvailability();
    if (status.available) return true;
    const pdfLinks = [
      "https://wkhtmltopdf.org/downloads.html",
      "https://github.com/wkhtmltopdf/packaging/releases/tag/0.12.6-1",
    ];
    const pdfLinksHtml = pdfLinks
      .map((url) => `<div><a href="${url}">${url}</a></div>`)
      .join("");
    const dialog = openResourceInstallDialog({
      title: t("pdf.dialog_title"),
      body: `
        <div>${t("pdf.dialog_body")}</div>
        <div class="storage-dialog__hint">${t("pdf.dialog_manual")}</div>
        <div class="storage-dialog__hint">${t("pdf.dialog_manual_links")}</div>
        <div class="storage-dialog__meta">${pdfLinksHtml}</div>
      `,
      actionLabel: t("pdf.dialog_install"),
    });
    dialog.setStatus(t("pdf.dialog_idle"), "muted");
    dialog.setBusy(false);
    dialog.actionButton?.addEventListener("click", async () => {
      dialog.setBusy(true);
      dialog.setStatus(t("pdf.dialog_downloading"), "muted");
      try {
        await installPdfResources((payload) => {
          const useBytes = payload.total > 0 && payload.current <= payload.total;
          const current = useBytes ? payload.current : payload.index;
          const total = useBytes ? payload.total : payload.count;
          dialog.setProgress(current, total);
          dialog.setStatus(t("pdf.dialog_downloading"), "muted");
        });
        dialog.setStatus(t("pdf.dialog_done"), "success");
        openRestartDialog(t("pdf.dialog_restart"));
      } catch (err) {
        dialog.setStatus(`${t("pdf.dialog_failed")}: ${String(err)}`, "error");
      } finally {
        dialog.setBusy(false);
      }
    }, { once: true });
    return false;
  };

  let openSearchModal = () => {};
  let openHistoryModal = () => {};
  let openSettingsModal = () => {};
  const layout = createAppLayout(root, {
    onSearch: () => openSearchModal(),
    onNewNote: () => actions.createNote(),
  });

  layout.titleInput.addEventListener("input", () => {
    if (appStore.getState().selectedNoteId) {
      actions.setTitle(layout.titleInput.value);
    }
  });

  const metaBar = mountMetaBar(layout.editorShell, {
    onBack: () => actions.goBack(),
    onForward: () => actions.goForward(),
    onOpenNoteMenu: (noteId, x, y) => {
      const title = appStore.getState().activeNote?.title || "Note";
      openNoteMetaMenu({
        x,
        y,
        noteId,
        onExportPdfNative: async (id) => {
          if (!(await ensurePdfResources())) return;
          showExportResult(await exportNotePdfNative(id, title));
        },
        onExportHtml: async (id) => showExportResult(await exportNoteHtmlOneFile(id, title)),
      });
    },
  });
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
      actions.openNote(noteId);
    },
  });
  openSearchModal = () => searchModal.open();

  const settingsModal = mountSettingsModal(layout.editorPane);
  openSettingsModal = () => settingsModal.open();

  const stopOcr = async () => {
    if (!cleanupOcr) return;
    const stop = cleanupOcr();
    cleanupOcr = undefined;
    await stop;
  };

  listen("menu-search", () => openSearchModal());
  listen("menu-history", () => openHistoryModal());
  listen("menu-settings", () => openSettingsModal());
  const importModal = mountEvernoteImportModal(layout.editorPane);
  listen("import-evernote", () => importModal.open());
  const notesClassicImportModal = mountNotesClassicImportModal(layout.editorPane, {
    onImportStart: async () => {
      await stopOcr();
    },
    onImportEnd: () => {
      if (!cleanupOcr) {
        cleanupOcr = startOcrQueue();
      }
    },
  });
  listen("import-notes-classic", () => notesClassicImportModal.open());
  const obsidianImportModal = mountObsidianImportModal(layout.editorPane, {
    onImportStart: async () => {
      await stopOcr();
    },
    onImportEnd: () => {
      if (!cleanupOcr) {
        cleanupOcr = startOcrQueue();
      }
    },
  });
  listen("import-obsidian", () => obsidianImportModal.open());
  const htmlImportModal = mountHtmlImportModal(layout.editorPane, {
    onImportStart: async () => {
      await stopOcr();
    },
    onImportEnd: () => {
      if (!cleanupOcr) {
        cleanupOcr = startOcrQueue();
      }
    },
  });
  listen("import-html", () => htmlImportModal.open());
  const textImportModal = mountTextImportModal(layout.editorPane, {
    onImportStart: async () => {
      await stopOcr();
    },
    onImportEnd: () => {
      if (!cleanupOcr) {
        cleanupOcr = startOcrQueue();
      }
    },
  });
  listen("import-text", () => textImportModal.open());

  const historyModal = mountHistoryModal(layout.editorPane, {
    onOpenNote: (noteId) => actions.openNote(noteId),
  });
  openHistoryModal = () => historyModal.open();
  const exportModal = mountExportModal(layout.editorPane);
  const exportObsidianModal = mountExportModalWith(layout.editorPane, {
    titleKey: "export_obsidian.title",
    hintKey: "export_obsidian.hint",
    selectKey: "export.select_folder",
    exportKey: "export.export",
    readyKey: "export.ready",
    runningKey: "export.running",
    finishedKey: "export.finished",
    failedKey: "export.failed",
    doneTitleKey: "export_obsidian.done_title",
    reportKey: "export.report_saved",
    runExport: runObsidianExport,
  });
  const exportHtmlModal = mountExportModalWith(layout.editorPane, {
    titleKey: "export_html.title",
    hintKey: "export_html.hint",
    selectKey: "export.select_folder",
    exportKey: "export.export",
    readyKey: "export.ready",
    runningKey: "export.running",
    finishedKey: "export.finished",
    failedKey: "export.failed",
    doneTitleKey: "export_html.done_title",
    reportKey: "export.report_saved",
    runExport: runHtmlExport,
  });
  const exportTextModal = mountExportModalWith(layout.editorPane, {
    titleKey: "export_text.title",
    hintKey: "export_text.hint",
    selectKey: "export.select_folder",
    exportKey: "export.export",
    readyKey: "export.ready",
    runningKey: "export.running",
    finishedKey: "export.finished",
    failedKey: "export.failed",
    doneTitleKey: "export_text.done_title",
    reportKey: "export.report_saved",
    runExport: runTextExport,
  });
  listen("export-notes-classic", () => exportModal.open());
  listen("export-obsidian", () => exportObsidianModal.open());
  listen("export-html", () => exportHtmlModal.open());
  listen("export-text", () => exportTextModal.open());

  const sidebarHandlers: SidebarHandlers = {
    onSelectNotebook: (id) => actions.selectNotebook(id),
    onSelectAll: () => actions.selectNotebook(null),
    onSelectTag: (id) => actions.selectTag(id),
    onSelectTrash: () => actions.selectTrash(),
    onToggleNotebook: (id) => actions.toggleNotebook(id),
    onToggleTag: (id) => actions.toggleTag(id),
    onCreateNotebook: (parentId) => actions.createNotebook(parentId),
    onCreateTag: (parentId) => actions.createTag(parentId),
    onToggleTagsSection: () => actions.toggleTagsSection(),
    onCreateNoteInNotebook: (id) => actions.createNoteInNotebook(id),
    onRenameNotebook: (id) => actions.renameNotebook(id),
    onDeleteNotebook: (id) => actions.deleteNotebook(id),
    onRenameTag: (id) => actions.renameTag(id),
    onTagContextMenu: (event, id) => {
      event.preventDefault();
      openTagContextMenu({
        x: event.clientX,
        y: event.clientY,
        tagId: id,
        onRename: actions.renameTag,
        onDelete: actions.deleteTag,
      });
    },
    onNotebookContextMenu: (event, id) => {
      event.preventDefault();
      openNotebookContextMenu({
        x: event.clientX,
        y: event.clientY,
        notebookId: id,
        onRename: actions.renameNotebook,
        onDelete: actions.deleteNotebook,
      });
    },
    onTrashContextMenu: (event) => {
      event.preventDefault();
      openTrashContextMenu({
        x: event.clientX,
        y: event.clientY,
        onRestoreAll: actions.restoreAllTrash,
        onEmptyTrash: actions.emptyTrash,
      });
    },
    onMoveTag: (tagId, parentId) => actions.moveTag(tagId, parentId),
    onMoveNotebook: (activeId, overId, position) => actions.moveNotebookByDrag(activeId, overId, position),
  };

  const notesListHandlers: NotesListHandlers = {
    onSelectNote: (id) => actions.openNote(id),
    onSelectNotes: (ids, primaryId) => actions.setNoteSelectionWithHistory(ids, primaryId),
    onDeleteNote: (id) => actions.deleteNote(id),
    onRenameNote: (id) => actions.renameNote(id),
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
      const exportTitleMap = new Map(
        state.notes.map((note) => [note.id, note.title || "Note"])
      );
      const selectedIds = state.selectedNoteIds;
      if (state.selectedTrash) {
        if (selectedIds.size > 1) {
          openTrashNotesContextMenu({
            x: event.clientX,
            y: event.clientY,
            noteIds: Array.from(selectedIds),
            onRestore: actions.restoreNotes,
            onDelete: actions.deleteNotes,
          });
          return;
        }
        openTrashNoteContextMenu({
          x: event.clientX,
          y: event.clientY,
          noteId: id,
          onRestore: actions.restoreNote,
          onDelete: (noteId) => actions.deleteNotes([noteId]),
        });
        return;
      }
      if (selectedIds.size > 1) {
        const nodes = buildMenuNodes(null, state);
        openNotesContextMenu({
          x: event.clientX,
          y: event.clientY,
          noteIds: Array.from(selectedIds),
          nodes,
          onDelete: actions.deleteNotes,
          onMove: actions.moveNotesToNotebook,
          onExportPdf: async (ids) => {
            if (!(await ensurePdfResources())) return;
            showExportResult(await exportNotesPdfNative(ids, exportTitleMap));
          },
          onExportHtml: async (ids) => showExportResult(await exportNotesHtmlOneFile(ids, exportTitleMap)),
        });
        return;
      }
      const nodes = buildMenuNodes(null, state);
      openNoteContextMenu({
        x: event.clientX,
        y: event.clientY,
        noteId: id,
        nodes,
        onDelete: actions.deleteNote,
        onDuplicate: actions.duplicateNote,
        onMove: actions.moveNoteToNotebook,
        onRename: actions.renameNote,
        onExportPdf: async (noteId) => {
          if (!(await ensurePdfResources())) return;
          showExportResult(await exportNotesPdfNative([noteId], exportTitleMap));
        },
        onExportHtml: async (noteId) => showExportResult(await exportNotesHtmlOneFile([noteId], exportTitleMap)),
      });
    },
    onMoveNotes: (noteIds, notebookId) => {
      if (appStore.getState().selectedTrash) return;
      actions.moveNotesToNotebook(noteIds, notebookId);
    },
    onDropToTrash: (noteIds) => actions.deleteNotes(noteIds),
    onDropToTag: (noteIds, tagId) => actions.addTagToNotes(noteIds, tagId),
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
    onOpenNote: (target) => actions.openNoteByLink(target),
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
  editorScheduler.setOnIdle(() => {
    renderer.render(appStore.getState());
  });

  let isResizingSidebar = false;
  let isResizingList = false;
  const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };
  const handleHistoryKey = (event: KeyboardEvent) => {
    if (!event.altKey) return;
    if (isEditableTarget(event.target)) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      actions.goBack();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      actions.goForward();
    }
  };
  const handleHistoryMouse = (event: MouseEvent) => {
    if (isEditableTarget(event.target)) return;
    if (event.button === 3) {
      event.preventDefault();
      actions.goBack();
    } else if (event.button === 4) {
      event.preventDefault();
      actions.goForward();
    }
  };

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
  window.addEventListener("keydown", handleHistoryKey);
  window.addEventListener("mouseup", handleHistoryMouse, true);

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
    historyModal.destroy();
    importModal.destroy();
    notesClassicImportModal.destroy();
    metaBar.destroy();
    tagsBar.destroy();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("keydown", handleHistoryKey);
    window.removeEventListener("mouseup", handleHistoryMouse, true);
    layout.destroy();
  };
};
