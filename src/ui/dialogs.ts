import { t } from "../services/i18n";

type NotebookDialogOptions = {
  parentId: number | null;
};

type TagDialogOptions = {
  parentId: number | null;
};

type RenameNotebookDialogOptions = {
  notebookType: "stack" | "notebook";
  name: string;
};

type RenameTagDialogOptions = {
  name: string;
};

type RenameNoteDialogOptions = {
  name: string;
};

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PasswordDialogOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

const escapeAttr = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const openNotebookDialog = ({ parentId }: NotebookDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    const title = parentId === null ? t("dialog.notebook_stack_title") : t("dialog.notebook_title");
    const subtitle = parentId === null
      ? t("dialog.notebook_stack_subtitle")
      : t("dialog.notebook_subtitle");
    const placeholder = parentId === null ? t("dialog.notebook_stack_placeholder") : t("dialog.notebook_placeholder");

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <p class="dialog__subtitle">${subtitle}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${t("dialog.name")}</label>
          <input
            class="dialog__input"
            placeholder="${placeholder}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${t("dialog.cancel")}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${t("dialog.create")}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.enter_name"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    input?.focus();
  });
};

export const openRenameNotebookDialog = ({
  notebookType,
  name,
}: RenameNotebookDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    const title = notebookType === "stack"
      ? t("dialog.notebook_stack_rename_title")
      : t("dialog.notebook_rename_title");
    const subtitle = notebookType === "stack"
      ? t("dialog.notebook_stack_rename_subtitle")
      : t("dialog.notebook_rename_subtitle");

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <p class="dialog__subtitle">${subtitle}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${t("dialog.name")}</label>
          <input
            class="dialog__input"
            value="${escapeAttr(name)}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${t("dialog.cancel")}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${t("dialog.rename")}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.enter_name"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    }
  });
};

export const openTagDialog = ({ parentId }: TagDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    const title = parentId === null ? t("dialog.tag_title") : t("dialog.tag_nested_title");
    const subtitle = parentId === null
      ? t("dialog.tag_subtitle")
      : t("dialog.tag_nested_subtitle");
    const placeholder = t("dialog.tag_placeholder");

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <p class="dialog__subtitle">${subtitle}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${t("dialog.name")}</label>
          <input
            class="dialog__input"
            placeholder="${placeholder}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${t("dialog.cancel")}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${t("dialog.create")}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.enter_name"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    input?.focus();
  });
};

export const openRenameTagDialog = ({ name }: RenameTagDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${t("dialog.tag_rename_title")}</h3>
          <p class="dialog__subtitle">${t("dialog.tag_rename_subtitle")}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${t("dialog.name")}</label>
          <input
            class="dialog__input"
            value="${escapeAttr(name)}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${t("dialog.cancel")}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${t("dialog.rename")}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.enter_name"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    }
  });
};

export const openRenameNoteDialog = ({ name }: RenameNoteDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${t("dialog.note_rename_title")}</h3>
          <p class="dialog__subtitle">${t("dialog.note_rename_subtitle")}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${t("dialog.name")}</label>
          <input
            class="dialog__input"
            value="${escapeAttr(name)}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${t("dialog.cancel")}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${t("dialog.rename")}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.enter_name"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    if (input) {
      input.focus();
      input.select();
    }
  });
};

export const openPasswordDialog = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
}: PasswordDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";
    const resolvedMessage = message ?? t("dialog.password_prompt");
    const resolvedConfirmLabel = confirmLabel ?? t("dialog.unlock");
    const resolvedCancelLabel = cancelLabel ?? t("dialog.cancel");

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${resolvedMessage}</label>
          <input
            class="dialog__input"
            type="password"
            placeholder="${t("dialog.password_placeholder")}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${resolvedCancelLabel}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${resolvedConfirmLabel}
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (text: string) => {
      if (!error) return;
      error.textContent = text;
      error.classList.remove("is-hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError(t("dialog.password_error"));
        return;
      }
      cleanup(value);
    };

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(null)));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("is-hidden");
    });
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") {
        cleanup(null);
      }
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(null);
    });

    document.body.appendChild(overlay);
    input?.focus();
  });
};

export const openConfirmDialog = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
}: ConfirmDialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";
    const resolvedConfirmLabel = confirmLabel ?? t("dialog.confirm");
    const resolvedCancelLabel = cancelLabel ?? t("dialog.cancel");

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="${t("settings.close")}">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body dialog__body--message">
          ${message}
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${resolvedCancelLabel}
          </button>
          <button class="dialog__button ${danger ? "dialog__button--danger" : "dialog__button--primary"}" data-dialog-confirm="1">
            ${resolvedConfirmLabel}
          </button>
        </div>
      </div>
    `;

    const cleanup = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    const cancelBtns = overlay.querySelectorAll("[data-dialog-cancel]");
    const confirmBtn = overlay.querySelector("[data-dialog-confirm]") as HTMLButtonElement | null;
    const closeBtns = overlay.querySelectorAll("[data-dialog-close]");

    cancelBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(false)));
    closeBtns.forEach((btn) => btn.addEventListener("click", () => cleanup(false)));
    confirmBtn?.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(false);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cleanup(false);
      if (event.key === "Enter") cleanup(true);
    }, { once: true });

    document.body.appendChild(overlay);
  });
};
