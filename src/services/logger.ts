const ENABLE_ERROR_LOGS = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

export const logError = (context: string, error: unknown) => {
  if (!ENABLE_ERROR_LOGS) return;
  console.error(context, error);
};
