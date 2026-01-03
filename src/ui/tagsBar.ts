import type { Tag } from "../state/types";
import { createIcon } from "./icons";
import { t } from "../services/i18n";

export type TagsBarState = {
  hasNote: boolean;
  tags: Tag[];
  noteTags: Tag[];
};

export type TagsBarHandlers = {
  onAddTag: (name: string) => void;
  onRemoveTag: (tagId: number) => void;
};

export const mountTagsBar = (container: HTMLElement, handlers: TagsBarHandlers) => {
  const tagsBar = document.createElement("div");
  tagsBar.className = "app-shell__tags";
  const tagsIcon = createIcon("icon-tag", "app-shell__tags-icon");
  const tagsList = document.createElement("div");
  tagsList.className = "app-shell__tags-list";
  const tagsInputWrap = document.createElement("div");
  tagsInputWrap.className = "app-shell__tags-input";
  const tagsSuggest = document.createElement("div");
  tagsSuggest.className = "app-shell__tags-suggest";
  const tagsInput = document.createElement("input");
  tagsInput.className = "app-shell__tags-field";
  tagsInput.type = "text";
  tagsInput.placeholder = t("tags.placeholder");
  tagsInputWrap.appendChild(tagsSuggest);
  tagsInputWrap.appendChild(tagsInput);
  tagsBar.appendChild(tagsIcon);
  tagsBar.appendChild(tagsList);
  tagsBar.appendChild(tagsInputWrap);
  container.appendChild(tagsBar);

  let currentState: TagsBarState = { hasNote: false, tags: [], noteTags: [] };
  let tagSuggestions: Tag[] = [];
  let tagSuggestIndex = 0;

  const buildTagPath = (tag: Tag, map: Map<number, Tag>) => {
    const parts = [tag.name];
    let current = tag;
    while (current.parentId) {
      const parent = map.get(current.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" / ");
  };

  const updateTagSuggestions = (preserveIndex = false) => {
    const query = tagsInput.value.trim().toLowerCase();
    const assigned = new Set(currentState.noteTags.map((tag) => tag.id));
    if (query.length < 2) {
      tagSuggestions = [];
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
      return;
    }
    tagSuggestions = currentState.tags
      .filter((tag) => !assigned.has(tag.id))
      .filter((tag) => tag.name.toLowerCase().startsWith(query))
      .slice(0, 8);
    if (!preserveIndex) {
      tagSuggestIndex = 0;
    } else {
      tagSuggestIndex = Math.min(tagSuggestIndex, Math.max(tagSuggestions.length - 1, 0));
    }
    if (tagSuggestions.length === 0) {
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
      return;
    }
    tagsSuggest.innerHTML = tagSuggestions
      .map((tag, index) => {
        return `
          <button class="app-shell__tags-suggest-item ${index === tagSuggestIndex ? "is-active" : ""}" data-tag-id="${tag.id}">
            ${tag.name}
          </button>
        `;
      })
      .join("");
    tagsSuggest.style.display = "block";
  };

  const applyTagSuggestion = (tag?: Tag) => {
    const name = tag?.name ?? tagsInput.value.trim();
    if (!name) return;
    if (tag) {
      if (currentState.noteTags.some((entry) => entry.id === tag.id)) {
        return;
      }
    }
    handlers.onAddTag(name);
    tagsInput.value = "";
    tagSuggestions = [];
    tagsSuggest.style.display = "none";
    tagsSuggest.innerHTML = "";
  };

  const handleTagsKeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      if (tagSuggestions.length === 0) return;
      event.preventDefault();
      tagSuggestIndex = Math.min(tagSuggestIndex + 1, tagSuggestions.length - 1);
      updateTagSuggestions(true);
      return;
    }
    if (event.key === "ArrowUp") {
      if (tagSuggestions.length === 0) return;
      event.preventDefault();
      tagSuggestIndex = Math.max(tagSuggestIndex - 1, 0);
      updateTagSuggestions(true);
      return;
    }
    if (event.key === "Enter") {
      if (!tagsInput.value.trim()) return;
      event.preventDefault();
      if (tagSuggestions.length > 0) {
        applyTagSuggestion(tagSuggestions[tagSuggestIndex]);
      } else {
        applyTagSuggestion();
      }
      return;
    }
    if (event.key === "Tab") {
      if (!tagsInput.value.trim()) return;
      event.preventDefault();
      applyTagSuggestion();
      return;
    }
    if (event.key === "Escape") {
      tagSuggestions = [];
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
    }
  };

  const handleSuggestClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const item = target.closest<HTMLElement>("[data-tag-id]");
    if (!item) return;
    const id = Number(item.dataset.tagId);
    if (!Number.isFinite(id)) return;
    const tag = tagSuggestions.find((entry) => entry.id === id);
    if (!tag) return;
    applyTagSuggestion(tag);
  };

  const handleTagRemove = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const button = target.closest<HTMLElement>("[data-tag-id]");
    if (!button) return;
    const id = Number(button.dataset.tagId);
    if (!Number.isFinite(id)) return;
    handlers.onRemoveTag(id);
  };

  const handleTagsInput = () => updateTagSuggestions();
  tagsInput.addEventListener("input", handleTagsInput);
  tagsInput.addEventListener("keydown", handleTagsKeydown);
  tagsSuggest.addEventListener("mousedown", handleSuggestClick);
  tagsList.addEventListener("click", handleTagRemove);

  const update = (state: TagsBarState) => {
    currentState = state;
    if (!state.hasNote) {
      tagsList.innerHTML = "";
      tagsInput.value = "";
      tagsSuggest.style.display = "none";
      tagsSuggest.innerHTML = "";
      return;
    }
    const map = new Map(state.tags.map((tag) => [tag.id, tag]));
    tagsList.innerHTML = state.noteTags
      .map((tag) => {
        const label = buildTagPath(tag, map);
        return `
          <span class="app-shell__tag">
            <span class="app-shell__tag-text">${label}</span>
            <button type="button" class="app-shell__tag-remove" data-tag-id="${tag.id}" aria-label="${t("tags.remove")}">&times;</button>
          </span>
        `;
      })
      .join("");
  };

  const destroy = () => {
    tagsInput.removeEventListener("input", handleTagsInput);
    tagsInput.removeEventListener("keydown", handleTagsKeydown);
    tagsSuggest.removeEventListener("mousedown", handleSuggestClick);
    tagsList.removeEventListener("click", handleTagRemove);
    tagsBar.remove();
  };

  return {
    element: tagsBar,
    update,
    destroy,
  };
};
