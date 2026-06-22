// Centralized constants - avoid magic strings scattered through code

export { DEFAULT_PICKUP } from "../config/site";
export const DEFAULT_DROPOFF = "TBD";
export const DEFAULT_STATUS = "pending" as const;

// Week number calculation (single source of truth)
export function getWeekNumber(dateString: string | undefined): number | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getWeekLabel(dateString: string | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const weekNum = getWeekNumber(dateString);
  if (!weekNum) return null;
  return `Week ${weekNum}, ${date.getFullYear()}`;
}

// Busy day threshold
export const BUSY_DAY_THRESHOLD = 5;

// Pagination
export const ITEMS_PER_PAGE = 20;

// Current week + N weeks range
export const WEEK_RANGE = 5; // current + 4

export function getWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + WEEK_RANGE * 7);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
