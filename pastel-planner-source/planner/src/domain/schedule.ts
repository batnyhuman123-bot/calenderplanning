import { addDays, diffDays, maxDate, minDate, toEpochDay } from './dates';
import { durationDays } from './tasks';
import type { ISODate, Phase, Task } from './types';

/**
 * Linked auto-scheduling (MS Project style, finish-to-start).
 *
 *  - A task with prerequisites starts on the day after its LATEST
 *    prerequisite finishes, plus its own gap (`lagDays`, may be negative for
 *    an overlap). Its duration is preserved.
 *  - Moving a prerequisite therefore moves every task downstream of it, in
 *    both directions. Moving a dependent task by hand changes its gap.
 *  - A task with subtasks is a summary: its dates span its subtasks and its
 *    progress is their duration-weighted average.
 *  - Phases stretch to cover their tasks.
 */

const earliestStart = (preds: Task[]) => addDays(maxDate(...preds.map((p) => p.endDate)), 1);

/** Gap implied by a task's current dates relative to its prerequisites (null when it has none). */
export function impliedLag(t: Task, byId: Map<string, Task>): number | null {
  const preds = t.dependencyIds.map((id) => byId.get(id)).filter(Boolean) as Task[];
  if (!preds.length) return null;
  return diffDays(earliestStart(preds), t.startDate);
}

/** Topological order over dependency + parent links (cycles are prevented elsewhere; any leftovers are appended). */
function order(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: Task[] = [];
  const visit = (t: Task, stack: Set<string>) => {
    if (seen.has(t.id) || stack.has(t.id)) return;
    stack.add(t.id);
    for (const id of t.dependencyIds) { const p = byId.get(id); if (p) visit(p, stack); }
    stack.delete(t.id);
    seen.add(t.id);
    out.push(t);
  };
  tasks.forEach((t) => visit(t, new Set()));
  return out;
}

export interface ScheduleResult {
  tasks: Task[];
  /** Tasks whose dates or progress changed because of the links (excluding the edited one). */
  changed: Task[];
}

/**
 * Re-runs the schedule over all tasks and returns the updated list.
 * `editedId` is the task the user just changed: its own dates are kept and
 * its gap is re-derived from them, so a manual move sticks.
 */
export function autoSchedule(input: Task[], edited: string | string[] = [], opts: { relinked?: boolean; previous?: Task[] } = {}): ScheduleResult {
  const editedIds = new Set(Array.isArray(edited) ? edited : [edited]);
  const work = new Map(input.map((t) => [t.id, { ...t }]));
  const children = new Map<string, Task[]>();
  const hasChildren = (id: string) => (children.get(id)?.length ?? 0) > 0;
  const rebuildChildren = () => {
    children.clear();
    for (const t of work.values()) if (t.parentTaskId && work.has(t.parentTaskId)) {
      if (!children.has(t.parentTaskId)) children.set(t.parentTaskId, []);
      children.get(t.parentTaskId)!.push(t);
    }
  };
  rebuildChildren();

  // 1. Lags: the edited task takes its gap from its new dates; others keep theirs
  //    (older records without one adopt their current gap, never less than 0).
  // Gaps for records that have none yet are read from the state BEFORE this edit.
  const prev = opts.previous ? new Map(opts.previous.map((t) => [t.id, t])) : work;
  for (const t of work.values()) {
    const implied = impliedLag(t, work);
    if (implied === null) continue;
    if (editedIds.has(t.id)) t.lagDays = opts.relinked ? Math.max(0, implied) : implied;
    else if (t.lagDays === undefined || t.lagDays === null) {
      const old = prev.get(t.id);
      const before = old ? impliedLag({ ...old, dependencyIds: t.dependencyIds }, prev) : null;
      t.lagDays = Math.max(0, before ?? implied);
    }
  }

  // 2. Forward pass in dependency order. Summary (parent) tasks are placed after their children.
  const shiftSubtree = (rootId: string, days: number) => {
    if (!days) return;
    for (const c of children.get(rootId) ?? []) {
      c.startDate = addDays(c.startDate, days);
      c.endDate = addDays(c.endDate, days);
      shiftSubtree(c.id, days);
    }
  };
  const rollUp = (id: string) => {
    const kids = children.get(id);
    const t = work.get(id)!;
    if (!kids?.length) return;
    kids.forEach((k) => rollUp(k.id));
    t.startDate = minDate(...kids.map((k) => k.startDate));
    t.endDate = maxDate(...kids.map((k) => k.endDate));
    if (t.status !== 'completed' && t.status !== 'cancelled') {
      let w = 0, s = 0;
      for (const k of kids) { const wt = Math.max(1, durationDays(k)); w += wt; s += wt * (k.status === 'completed' ? 100 : k.progress); }
      t.progress = Math.round(s / w);
    }
  };

  for (let pass = 0; pass < 3; pass++) {
    for (const t of order([...work.values()])) {
      const preds = t.dependencyIds.map((id) => work.get(id)).filter(Boolean) as Task[];
      if (!preds.length) continue;
      const target = addDays(earliestStart(preds), t.lagDays ?? 0);
      if (target === t.startDate) continue;
      const delta = diffDays(t.startDate, target);
      const len = diffDays(t.startDate, t.endDate);
      t.startDate = target;
      t.endDate = t.isMilestone ? target : addDays(target, len);
      // A summary task that is pushed carries its subtasks with it.
      if (hasChildren(t.id)) shiftSubtree(t.id, delta);
    }
    for (const t of work.values()) if (!t.parentTaskId || !work.has(t.parentTaskId)) rollUp(t.id);
  }

  const tasks = input.map((t) => work.get(t.id)!);
  const changed = tasks.filter((t, i) => !editedIds.has(t.id) && (
    t.startDate !== input[i].startDate || t.endDate !== input[i].endDate || t.progress !== input[i].progress || t.lagDays !== input[i].lagDays));
  return { tasks, changed };
}

/** Phases stretch to cover their tasks. Returns only phases that changed. */
export function fitPhases(phases: Phase[], tasks: Task[]): Phase[] {
  const out: Phase[] = [];
  for (const ph of phases) {
    const own = tasks.filter((t) => t.phaseId === ph.id);
    if (!own.length) continue;
    const s = minDate(...own.map((t) => t.startDate));
    const e = maxDate(...own.map((t) => t.endDate));
    if (s !== ph.startDate || e !== ph.endDate) out.push({ ...ph, startDate: s, endDate: e });
  }
  return out;
}

/** Shift a task and all its subtasks by `days` (used when dragging a summary task). */
export function shiftWithSubtasks(tasks: Task[], rootId: string, days: number): Task[] {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tasks) if (t.parentTaskId && ids.has(t.parentTaskId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
  }
  return tasks.map((t) => (ids.has(t.id) ? { ...t, startDate: addDays(t.startDate, days), endDate: addDays(t.endDate, days) } : t));
}

export const isSummaryTask = (tasks: Task[], id: string) => tasks.some((t) => t.parentTaskId === id);

export function describeLink(t: Task, tasks: Task[]): string | null {
  const preds = t.dependencyIds.map((id) => tasks.find((x) => x.id === id)).filter(Boolean) as Task[];
  if (!preds.length) return null;
  const latest = preds.reduce((a, b) => (toEpochDay(a.endDate) >= toEpochDay(b.endDate) ? a : b));
  const lag = t.lagDays ?? 0;
  const n = (k: number) => `${k} day${k === 1 ? '' : 's'}`;
  if (lag === 0) return `Linked: starts the day after “${latest.title}” finishes.`;
  if (lag > 0) return `Linked: starts after “${latest.title}” finishes, with a ${n(lag)} gap.`;
  return `Linked: overlaps “${latest.title}” by ${n(-lag)}.`;
}

export type { ISODate };
