import type { ISODate } from './types';

/**
 * Date utilities. All calendar arithmetic is done on integer "epoch days"
 * (days since 1970-01-01, computed in UTC), so month lengths, leap years
 * and DST transitions can never shift an all-day item by a day.
 */

const MS_DAY = 86_400_000;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

const pad = (n: number) => String(n).padStart(2, '0');

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m - 1);
}

export function toEpochDay(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function fromEpochDay(day: number): ISODate {
  const dt = new Date(day * MS_DAY);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function makeDate(year: number, monthIndex: number, day: number): ISODate {
  return fromEpochDay(Math.round(Date.UTC(year, monthIndex, day) / MS_DAY));
}

export function parts(iso: ISODate) {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/** Today in the viewer's local timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromEpochDay(toEpochDay(iso) + n);
}

/** Signed difference in days (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday (4). */
export function weekday(iso: ISODate): number {
  return (((toEpochDay(iso) + 4) % 7) + 7) % 7;
}

export function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, monthIndex: number) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex];
}

export function addMonths(year: number, monthIndex: number, delta: number) {
  const total = year * 12 + monthIndex + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function startOfWeek(iso: ISODate, weekStartsOn: 0 | 1 = 0): ISODate {
  const wd = weekday(iso);
  const back = (wd - weekStartsOn + 7) % 7;
  return addDays(iso, -back);
}

export function startOfMonth(iso: ISODate): ISODate {
  const p = parts(iso);
  return makeDate(p.year, p.month, 1);
}

/**
 * The weeks displayed for a month: from the week containing the 1st to the
 * week containing the last day (4–6 rows). Each week is 7 ISO dates.
 */
export function monthGrid(year: number, monthIndex: number, weekStartsOn: 0 | 1 = 0): ISODate[][] {
  const first = makeDate(year, monthIndex, 1);
  const last = makeDate(year, monthIndex, daysInMonth(year, monthIndex));
  let cursor = startOfWeek(first, weekStartsOn);
  const weeks: ISODate[][] = [];
  while (toEpochDay(cursor) <= toEpochDay(last)) {
    const week: ISODate[] = [];
    for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate) {
  return toEpochDay(aStart) <= toEpochDay(bEnd) && toEpochDay(bStart) <= toEpochDay(aEnd);
}

export function minDate(...ds: ISODate[]): ISODate {
  return ds.reduce((a, b) => (a < b ? a : b));
}
export function maxDate(...ds: ISODate[]): ISODate {
  return ds.reduce((a, b) => (a > b ? a : b));
}

/** ISO-8601 week number. */
export function isoWeek(iso: ISODate): number {
  const d = toEpochDay(iso);
  const wd = (weekday(iso) + 6) % 7; // Mon=0
  const thursday = d - wd + 3;
  const yearOfThursday = new Date(thursday * MS_DAY).getUTCFullYear();
  const jan1 = Math.round(Date.UTC(yearOfThursday, 0, 1) / MS_DAY);
  return Math.floor((thursday - jan1) / 7) + 1;
}

/* ---------- Formatting (display only — never stored) ---------- */

export function fmtDate(iso: ISODate, opts: { weekday?: boolean; year?: boolean } = {}) {
  const p = parts(iso);
  let s = `${p.day} ${MONTHS_SHORT[p.month]}`;
  if (opts.year !== false) s += ` ${p.year}`;
  if (opts.weekday) s = `${WEEKDAYS_SHORT[weekday(iso)]}, ${s}`;
  return s;
}

export function fmtRange(a: ISODate, b: ISODate) {
  if (a === b) return fmtDate(a);
  const pa = parts(a);
  const pb = parts(b);
  if (pa.year === pb.year) return `${fmtDate(a, { year: false })} – ${fmtDate(b)}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function fmtTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${pad(m)}${suffix}`;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

export function relativeDay(iso: ISODate, today: ISODate) {
  const d = diffDays(today, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days ago`;
  if (d < 7) return `In ${d} days`;
  return fmtDate(iso, { year: false });
}
