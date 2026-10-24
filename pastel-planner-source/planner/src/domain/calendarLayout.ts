import { toEpochDay, timeToMinutes } from './dates';
import type { ISODate, Task } from './types';

/**
 * A visual segment of one task inside one week row (or any run of
 * consecutive day columns). A multi-day task that crosses week rows is
 * split into several segments that share the same task id, title and
 * colour; `continuesBefore/After` let the UI draw flat, connected ends.
 */
export interface Segment {
  task: Task;
  startCol: number; // 0-based column inside the row
  endCol: number; // inclusive
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const isTimedSingleDay = (t: Task) => !t.allDay && t.startDate === t.endDate;

/** Ordering: earlier start, then longer spans, then all-day before timed, then time. */
function segmentOrder(a: Segment, b: Segment) {
  return (
    a.startCol - b.startCol ||
    (b.endCol - b.startCol) - (a.endCol - a.startCol) ||
    Number(isTimedSingleDay(a.task)) - Number(isTimedSingleDay(b.task)) ||
    (a.task.startTime ?? '').localeCompare(b.task.startTime ?? '') ||
    a.task.title.localeCompare(b.task.title)
  );
}

/**
 * Lays out the tasks that overlap the given consecutive days into lanes
 * using greedy interval packing. Each task occupies one lane across its
 * whole visible span, so multi-day bars stay continuous.
 */
export function layoutRow(days: ISODate[], tasks: Task[]): { segments: Segment[]; laneCount: number } {
  const first = toEpochDay(days[0]);
  const last = toEpochDay(days[days.length - 1]);
  const segs: Segment[] = [];
  for (const task of tasks) {
    const s = toEpochDay(task.startDate);
    const e = toEpochDay(task.endDate);
    if (e < first || s > last) continue;
    segs.push({
      task,
      startCol: Math.max(s, first) - first,
      endCol: Math.min(e, last) - first,
      lane: 0,
      continuesBefore: s < first,
      continuesAfter: e > last,
    });
  }
  segs.sort(segmentOrder);
  const laneEnds: number[] = [];
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(seg.endCol);
    } else laneEnds[lane] = seg.endCol;
    seg.lane = lane;
  }
  return { segments: segs, laneCount: laneEnds.length };
}

/** For each column, how many segments are hidden when only `visibleLanes` lanes are shown. */
export function hiddenCounts(segments: Segment[], columns: number, visibleLanes: number): number[] {
  const counts = new Array(columns).fill(0);
  for (const s of segments) {
    if (s.lane < visibleLanes) continue;
    for (let c = s.startCol; c <= s.endCol; c++) counts[c]++;
  }
  return counts;
}

/**
 * When a column overflows we reserve the last visible lane for the
 * "+N more" control, so it never collides with a bar. This returns the
 * effective lanes per column and the overflow counts.
 */
export function fitLanes(segments: Segment[], columns: number, maxLanes: number) {
  const perCol: Segment[][] = Array.from({ length: columns }, () => []);
  for (const s of segments) for (let c = s.startCol; c <= s.endCol; c++) perCol[c].push(s);
  const overflowing = perCol.map((list) => list.some((s) => s.lane >= maxLanes));
  // A segment is shown only if, for every column it covers, it fits within the allowed lanes.
  const visible = new Set<Segment>();
  for (const s of segments) {
    let ok = true;
    for (let c = s.startCol; c <= s.endCol; c++) {
      const limit = overflowing[c] ? maxLanes - 1 : maxLanes;
      if (s.lane >= limit) { ok = false; break; }
    }
    if (ok) visible.add(s);
  }
  const more = perCol.map((list) => list.filter((s) => !visible.has(s)).length);
  return { visible: segments.filter((s) => visible.has(s)), more };
}

/* ---------------- Timed events (week/day grid) ---------------- */

export interface TimedBlock {
  task: Task;
  top: number; // minutes from midnight
  bottom: number;
  col: number;
  cols: number;
}

/** Positions single-day timed tasks in one day column, splitting overlaps side by side. */
export function layoutTimed(tasks: Task[]): TimedBlock[] {
  const items = tasks
    .filter(isTimedSingleDay)
    .map((task) => {
      const top = timeToMinutes(task.startTime ?? '00:00');
      const bottom = Math.max(top + 30, timeToMinutes(task.endTime ?? task.startTime ?? '00:30'));
      return { task, top, bottom, col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const out: TimedBlock[] = [];
  let cluster: TimedBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.top);
      if (c === -1) { c = colEnds.length; colEnds.push(it.bottom); } else colEnds[c] = it.bottom;
      it.col = c;
    }
    for (const it of cluster) it.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.top >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.bottom);
  }
  if (cluster.length) flush();
  return out;
}

export { isTimedSingleDay };
