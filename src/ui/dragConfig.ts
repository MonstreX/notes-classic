export const DRAG_HOLD_MS = 180;
export const DRAG_START_PX = 6;

export const hasDragDistance = (dx: number, dy: number, threshold = DRAG_START_PX) =>
  Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
