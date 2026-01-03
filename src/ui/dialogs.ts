type NotebookDialogOptions = {
  parentId: number | null;
};

type TagDialogOptions = {
  parentId: number | null;
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

export const openNotebookDialog = ({ parentId }: NotebookDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    const title = parentId === null ? "Create notebook stack" : "Create notebook";
    const subtitle = parentId === null
      ? "Stacks appear at the top level."
      : "Notebooks can be created only inside stacks.";
    const placeholder = parentId === null ? "New stack" : "New notebook";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <p class="dialog__subtitle">${subtitle}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="Close">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">Name</label>
          <input
            class="dialog__input"
            placeholder="${placeholder}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            Cancel
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            Create
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
        showError("Enter a name");
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

export const openTagDialog = ({ parentId }: TagDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    const title = parentId === null ? "Create tag" : "Create nested tag";
    const subtitle = parentId === null
      ? "Tags can be nested."
      : "Nested tags stay grouped under the parent tag.";
    const placeholder = "New tag";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <p class="dialog__subtitle">${subtitle}</p>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="Close">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">Name</label>
          <input
            class="dialog__input"
            placeholder="${placeholder}"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            Cancel
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            Create
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
        showError("Enter a name");
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

export const openPasswordDialog = ({
  title,
  message = "Enter password",
  confirmLabel = "Unlock",
  cancelLabel = "Cancel",
}: PasswordDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="Close">
            <svg class="dialog__close-icon" aria-hidden="true">
              <use href="#icon-close"></use>
            </svg>
          </button>
        </div>
        <div class="dialog__body">
          <label class="dialog__label">${message}</label>
          <input
            class="dialog__input"
            type="password"
            placeholder="Password"
          />
          <div class="dialog__error is-hidden" data-dialog-error="1"></div>
        </div>
        <div class="dialog__footer">
          <button class="dialog__button dialog__button--ghost" data-dialog-cancel="1">
            ${cancelLabel}
          </button>
          <button class="dialog__button dialog__button--primary" data-dialog-submit="1">
            ${confirmLabel}
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
        showError("Enter a password");
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
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
}: ConfirmDialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.dataset.dialogOverlay = "1";

    overlay.innerHTML = `
      <div class="dialog">
        <div class="dialog__header">
          <h3 class="dialog__title">${title}</h3>
          <button class="dialog__close" type="button" data-dialog-close="1" aria-label="Close">
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
            ${cancelLabel}
          </button>
          <button class="dialog__button ${danger ? "dialog__button--danger" : "dialog__button--primary"}" data-dialog-confirm="1">
            ${confirmLabel}
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
