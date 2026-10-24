import {
  addDays, diffDays, isValidISODate, rangesOverlap, startOfWeek, timeToMinutes, toEpochDay, weekday,
} from './dates';
import type { ISODate, PlannerData, Project, Task, TaskStatus } from './types';
import { PRIORITY_RANK } from './types';

export const uid = (prefix = 't') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const nowISO = () => new Date().toISOString();

export function newTask(partial: Partial<Task> & { startDate: ISODate }): Task {
  const ts = nowISO();
  return {
    id: uid('t'),
    title: '',
    description: '',
    categoryId: 'work',
    endDate: partial.startDate,
    startTime: null,
    endTime: null,
    allDay: true,
    projectId: null,
    phaseId: null,
    parentTaskId: null,
    priority: 'medium',
    status: 'not_started',
    progress: 0,
    isMilestone: false,
    dependencyIds: [],
    includeInGantt: false,
    reminderAt: null,
    reminderDismissed: false,
    notes: '',
    baselineStart: null,
    baselineEnd: null,
    actualStart: null,
    actualEnd: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    ...partial,
  };
}

/* ---------------- Duration rules ----------------
 * Duration is counted in CALENDAR DAYS, inclusive of both start and end:
 *   duration = endDate − startDate + 1   (a task on 22–28 Oct = 7 days)
 * Milestones are zero-duration events and report 0.
 * Working days (Mon–Fri, no holiday calendar) are provided separately for
 * information and the Excel register; scheduling itself uses calendar days.
 */
export function durationDays(t: Pick<Task, 'startDate' | 'endDate' | 'isMilestone'>): number {
  if (t.isMilestone) return 0;
  return diffDays(t.startDate, t.endDate) + 1;
}

export function workingDays(start: ISODate, end: ISODate): number {
  let n = 0;
  const s = toEpochDay(start), e = toEpochDay(end);
  for (let d = s; d <= e; d++) {
    const wd = (((d + 4) % 7) + 7) % 7;
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export const isDone = (t: Task) => t.status === 'completed' || t.status === 'cancelled';

export function isOverdue(t: Task, today: ISODate): boolean {
  return !isDone(t) && toEpochDay(t.endDate) < toEpochDay(today);
}

export function occursOn(t: Task, day: ISODate) {
  return toEpochDay(t.startDate) <= toEpochDay(day) && toEpochDay(day) <= toEpochDay(t.endDate);
}

/* ---------------- Status transitions ---------------- */

/** Applies the side-effects of a status change (progress, completion and actual dates). */
export function applyStatus(t: Task, status: TaskStatus, today: ISODate): Task {
  const next: Task = { ...t, status };
  if (status === 'completed') {
    next.progress = 100;
    next.completedAt = t.completedAt ?? nowISO();
    next.actualEnd = t.actualEnd ?? today;
    next.actualStart = t.actualStart ?? (toEpochDay(t.startDate) <= toEpochDay(today) ? t.startDate : today);
  } else {
    next.completedAt = null;
    next.actualEnd = status === 'cancelled' ? t.actualEnd : null;
    if (t.status === 'completed' && next.progress === 100) next.progress = 90;
    if (status === 'in_progress' && !t.actualStart) next.actualStart = today;
  }
  return next;
}

/* ---------------- Dependencies ---------------- */

/** True if `fromId` can reach `targetId` by following dependencyIds (predecessor links). */
export function reaches(tasks: Map<string, Task>, fromId: string, targetId: string): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = tasks.get(id);
    if (t) stack.push(...t.dependencyIds);
  }
  return false;
}

/** Would making `taskId` depend on `predecessorId` create a cycle? */
export function createsCycle(tasks: Task[], taskId: string, predecessorId: string): boolean {
  if (taskId === predecessorId) return true;
  const map = new Map(tasks.map((t) => [t.id, t]));
  return reaches(map, predecessorId, taskId);
}

export interface DependencyIssue {
  predecessor: Task;
  kind: 'starts_before_finish' | 'predecessor_incomplete';
  message: string;
}

/** Finish-to-Start checks for a task against its predecessors. */
export function dependencyIssues(task: Task, tasks: Task[]): DependencyIssue[] {
  const issues: DependencyIssue[] = [];
  for (const pid of task.dependencyIds) {
    const p = tasks.find((t) => t.id === pid);
    if (!p) continue;
    if (toEpochDay(task.startDate) <= toEpochDay(p.endDate)) {
      issues.push({
        predecessor: p,
        kind: 'starts_before_finish',
        message: `Starts on or before “${p.title}” finishes (${p.endDate}). Finish-to-Start expects a start on ${addDays(p.endDate, 1)} or later.`,
      });
    }
    if ((task.status === 'in_progress' || task.status === 'completed') && p.status !== 'completed') {
      issues.push({
        predecessor: p,
        kind: 'predecessor_incomplete',
        message: `Prerequisite “${p.title}” is not completed yet.`,
      });
    }
  }
  return issues;
}

/* ---------------- Validation ---------------- */

export type FieldErrors = Partial<Record<keyof Task | 'form', string>>;

export function validateTask(t: Task, data: Pick<PlannerData, 'tasks' | 'projects' | 'phases' | 'categories'>): FieldErrors {
  const e: FieldErrors = {};
  if (!t.title.trim()) e.title = 'Enter a task title.';
  else if (t.title.length > 200) e.title = 'Keep the title under 200 characters.';
  if (!t.categoryId || !data.categories.some((c) => c.id === t.categoryId)) e.categoryId = 'Choose a category.';
  if (!isValidISODate(t.startDate)) e.startDate = 'Enter a valid start date.';
  if (!isValidISODate(t.endDate)) e.endDate = 'Enter a valid end date.';
  if (!e.startDate && !e.endDate && toEpochDay(t.endDate) < toEpochDay(t.startDate)) {
    e.endDate = 'End date cannot be before the start date.';
  }
  if (!t.allDay) {
    if (!t.startTime) e.startTime = 'Enter a start time, or switch to all-day.';
    if (!t.endTime) e.endTime = 'Enter an end time, or switch to all-day.';
    if (t.startTime && t.endTime && t.startDate === t.endDate && timeToMinutes(t.endTime) <= timeToMinutes(t.startTime)) {
      e.endTime = 'End time must be after the start time.';
    }
  }
  if (t.progress < 0 || t.progress > 100 || Number.isNaN(t.progress)) e.progress = 'Progress must be between 0 and 100.';
  if (t.projectId && !data.projects.some((p) => p.id === t.projectId)) e.projectId = 'That project no longer exists.';
  if (t.phaseId) {
    const ph = data.phases.find((p) => p.id === t.phaseId);
    if (!ph || ph.projectId !== t.projectId) e.phaseId = 'Choose a phase from the selected project.';
  }
  if (t.parentTaskId) {
    const parent = data.tasks.find((x) => x.id === t.parentTaskId);
    if (!parent) e.parentTaskId = 'The parent task no longer exists.';
    else if (parent.id === t.id) e.parentTaskId = 'A task cannot be its own parent.';
    else if (isDescendant(data.tasks, parent.id, t.id)) e.parentTaskId = 'A task cannot be placed under its own subtask.';
  }
  const missing = t.dependencyIds.filter((id) => !data.tasks.some((x) => x.id === id));
  if (missing.length) e.dependencyIds = 'A selected prerequisite no longer exists.';
  else if (t.dependencyIds.some((p) => createsCycle(data.tasks.filter((x) => x.id !== t.id).concat(t), t.id, p))) {
    e.dependencyIds = 'These prerequisites create a circular dependency.';
  }
  if (t.reminderAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t.reminderAt)) e.reminderAt = 'Enter a valid reminder date and time.';
  return e;
}

export function isDescendant(tasks: Task[], candidateId: string, ancestorId: string): boolean {
  let cur = tasks.find((t) => t.id === candidateId);
  const guard = new Set<string>();
  while (cur && cur.parentTaskId && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.parentTaskId === ancestorId) return true;
    cur = tasks.find((t) => t.id === cur!.parentTaskId);
  }
  return false;
}

/* ---------------- Deletion cascade ---------------- */

/** Ids removed when deleting a task: the task and all its subtasks. */
export function subtreeIds(tasks: Task[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const t of tasks) if (t.parentTaskId === out[i]) out.push(t.id);
  }
  return out;
}

/* ---------------- Projects ---------------- */

/** Duration-weighted average progress of a project's tasks (cancelled tasks excluded). */
export function projectProgress(p: Project, tasks: Task[]): number {
  if (p.progressMode === 'manual') return p.manualProgress;
  const own = tasks.filter((t) => t.projectId === p.id && t.status !== 'cancelled');
  if (!own.length) return 0;
  let w = 0, sum = 0;
  for (const t of own) {
    const weight = Math.max(1, durationDays(t));
    w += weight;
    sum += weight * (t.status === 'completed' ? 100 : t.progress);
  }
  return Math.round(sum / w);
}

/* ---------------- Queries ---------------- */

export interface TaskFilter {
  text?: string;
  categoryIds?: string[];
  projectId?: string | 'none' | '';
  priority?: string;
  status?: string;
  from?: ISODate | '';
  to?: ISODate | '';
}

export function matchesFilter(t: Task, f: TaskFilter): boolean {
  if (f.text) {
    const q = f.text.toLowerCase();
    if (!t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q) && !t.notes.toLowerCase().includes(q)) return false;
  }
  if (f.categoryIds && f.categoryIds.length && !f.categoryIds.includes(t.categoryId)) return false;
  if (f.projectId === 'none' && t.projectId) return false;
  if (f.projectId && f.projectId !== 'none' && t.projectId !== f.projectId) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.from && toEpochDay(t.endDate) < toEpochDay(f.from)) return false;
  if (f.to && toEpochDay(t.startDate) > toEpochDay(f.to)) return false;
  return true;
}

export type TaskSort = 'due' | 'priority' | 'created' | 'project';

export function sortTasks(list: Task[], sort: TaskSort, projects: Project[]): Task[] {
  const pname = (t: Task) => projects.find((p) => p.id === t.projectId)?.name ?? '￿';
  const byDue = (a: Task, b: Task) =>
    a.endDate.localeCompare(b.endDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title);
  return [...list].sort((a, b) => {
    switch (sort) {
      case 'priority': return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b);
      case 'created': return b.createdAt.localeCompare(a.createdAt);
      case 'project': return pname(a).localeCompare(pname(b)) || byDue(a, b);
      default: return byDue(a, b);
    }
  });
}

export function bucket(t: Task, today: ISODate, weekStartsOn: 0 | 1 = 0) {
  const ws = startOfWeek(today, weekStartsOn);
  const we = addDays(ws, 6);
  return {
    today: !isDone(t) && occursOn(t, today),
    overdue: isOverdue(t, today),
    thisWeek: !isDone(t) && rangesOverlap(t.startDate, t.endDate, today, we) && toEpochDay(t.endDate) >= toEpochDay(today),
    upcoming: !isDone(t) && toEpochDay(t.startDate) > toEpochDay(today),
    completed: t.status === 'completed',
  };
}

export const isWeekend = (iso: ISODate) => weekday(iso) === 0 || weekday(iso) === 6;
