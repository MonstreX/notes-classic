type NotebookDialogOptions = {
  parentId: number | null;
};

type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export const openNotebookDialog = ({ parentId }: NotebookDialogOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center bg-black/40";
    overlay.dataset.dialogOverlay = "1";

    const title = parentId === null ? "Create notebook stack" : "Create notebook";
    const subtitle = parentId === null
      ? "Stacks appear at the top level."
      : "Notebooks can be created only inside stacks.";
    const placeholder = parentId === null ? "New stack" : "New notebook";

    overlay.innerHTML = `
      <div class="w-[420px] rounded-lg bg-white shadow-xl text-black">
        <div class="px-5 py-4 border-b border-gray-200">
          <h3 class="text-sm font-semibold">${title}</h3>
          <p class="text-xs text-gray-500 mt-1">${subtitle}</p>
        </div>
        <div class="px-5 py-4">
          <label class="text-xs uppercase tracking-widest text-gray-500 font-semibold">Name</label>
          <input
            class="mt-2 w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-[#00A82D] outline-none"
            placeholder="${placeholder}"
          />
          <div class="text-xs text-red-500 mt-2 hidden" data-dialog-error="1"></div>
        </div>
        <div class="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50" data-dialog-cancel="1">
            Cancel
          </button>
          <button class="px-4 py-2 text-sm rounded bg-[#00A82D] text-white hover:bg-[#008f26]" data-dialog-submit="1">
            Create
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("input") as HTMLInputElement | null;
    const error = overlay.querySelector("[data-dialog-error]") as HTMLDivElement | null;
    const cancelBtn = overlay.querySelector("[data-dialog-cancel]") as HTMLButtonElement | null;
    const submitBtn = overlay.querySelector("[data-dialog-submit]") as HTMLButtonElement | null;

    const cleanup = (result: string | null) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (message: string) => {
      if (!error) return;
      error.textContent = message;
      error.classList.remove("hidden");
    };

    const submit = () => {
      const value = (input?.value || "").trim();
      if (!value) {
        showError("Enter a name");
        return;
      }
      cleanup(value);
    };

    cancelBtn?.addEventListener("click", () => cleanup(null));
    submitBtn?.addEventListener("click", submit);
    input?.addEventListener("input", () => {
      if (!error) return;
      error.textContent = "";
      error.classList.add("hidden");
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
    overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center bg-black/40";
    overlay.dataset.dialogOverlay = "1";

    const buttonClass = danger
      ? "bg-red-500 hover:bg-red-600"
      : "bg-[#00A82D] hover:bg-[#008f26]";

    overlay.innerHTML = `
      <div class="w-[420px] rounded-lg bg-white shadow-xl text-black">
        <div class="px-5 py-4 border-b border-gray-200">
          <h3 class="text-sm font-semibold">${title}</h3>
        </div>
        <div class="px-5 py-4 text-sm text-gray-700">
          ${message}
        </div>
        <div class="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50" data-dialog-cancel="1">
            ${cancelLabel}
          </button>
          <button class="px-4 py-2 text-sm rounded text-white ${buttonClass}" data-dialog-confirm="1">
            ${confirmLabel}
          </button>
        </div>
      </div>
    `;

    const cleanup = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    const cancelBtn = overlay.querySelector("[data-dialog-cancel]") as HTMLButtonElement | null;
    const confirmBtn = overlay.querySelector("[data-dialog-confirm]") as HTMLButtonElement | null;

    cancelBtn?.addEventListener("click", () => cleanup(false));
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
