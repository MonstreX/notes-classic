import type { NoteDetail, Tag } from "../state/types";
import { appStore } from "../state/store";
import { logError } from "../services/logger";
import { normalizeFileLinks, normalizeEnmlContent, toDisplayContent } from "../services/content";
import { getNote } from "../services/notes";
import { getNoteTags } from "../services/tags";

let noteLoadToken = 0;

export const loadSelectedNote = async () => {
  const initialState = appStore.getState();
  const noteId = initialState.selectedNoteId;
  if (!noteId) {
    appStore.setState({ activeNote: null, title: "", content: "", noteTags: [], isNoteLoading: false });
    return;
  }
  noteLoadToken += 1;
  const token = noteLoadToken;
  appStore.setState({ isNoteLoading: true });
  try {
    const note = await getNote(noteId);
    if (!note) {
      appStore.setState({ activeNote: null, title: "", content: "", noteTags: [] });
      return;
    }
    const currentState = appStore.getState();
    if (currentState.selectedNoteId !== noteId) return;
    const normalized = normalizeFileLinks(normalizeEnmlContent(note.content));
    const displayContent = await toDisplayContent(normalized);
    const finalNote: NoteDetail = displayContent !== note.content ? { ...note, content: displayContent } : note;
    const tags: Tag[] = await getNoteTags(noteId);
    appStore.setState({ activeNote: finalNote, title: finalNote.title, content: finalNote.content, noteTags: tags });
  } catch (e) {
    logError("[note] load failed", e);
  } finally {
    if (token === noteLoadToken) {
      appStore.setState({ isNoteLoading: false });
    }
  }
};
