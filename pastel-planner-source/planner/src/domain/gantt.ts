import {
  addDays, fromEpochDay, isoWeek, makeDate, MONTHS_SHORT, parts, startOfWeek, toEpochDay, weekday,
} from './dates';
import { durationDays, isOverdue } from './tasks';
import type { GanttZoom, ISODate, Phase, PlannerData, Project, Task, TaskStatus } from './types';
import { PHASE_PALETTE } from './defaults';

export type GanttRowKind = 'project' | 'phase' | 'task';

export interface GanttRow {
  key: string;
  kind: GanttRowKind;
  depth: number;
  label: string;
  start: ISODate;
  end: ISODate;
  progress: number;
  task?: Task;
  project?: Project;
  phase?: Phase;
  /** Visual state used for secondary indicators. */
  state?: 'completed' | 'in_progress' | 'blocked' | 'overdue' | 'normal';
  wbs: string;
  hasChildren: boolean;
  groupKey?: string; // for collapse
}

export interface GanttFilter {
  projectId?: string; // '' = all, 'none' = unassigned
  status?: TaskStatus | '';
  from?: ISODate | '';
  to?: ISODate | '';
}

export const NO_PROJECT = '__none__';

/** Tasks eligible for the Gantt: explicitly included, then narrowed by the view filter. */
export function ganttTasks(data: PlannerData, f: GanttFilter): Task[] {
  return data.tasks.filter((t) => {
    if (!t.includeInGantt) return false;
    if (f.projectId === 'none' && t.projectId) return false;
    if (f.projectId && f.projectId !== 'none' && t.projectId !== f.projectId) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.from && toEpochDay(t.endDate) < toEpochDay(f.from)) return false;
    if (f.to && toEpochDay(t.startDate) > toEpochDay(f.to)) return false;
    return true;
  });
}

export function taskState(t: Task, today: ISODate): GanttRow['state'] {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'blocked') return 'blocked';
  if (isOverdue(t, today)) return 'overdue';
  if (t.status === 'in_progress') return 'in_progress';
  return 'normal';
}

function span(tasks: Task[], extra: ISODate[] = []): [ISODate, ISODate] | null {
  const ds = tasks.flatMap((t) => [t.startDate, t.endDate]).concat(extra);
  if (!ds.length) return null;
  ds.sort();
  return [ds[0], ds[ds.length - 1]];
}

function avgProgress(tasks: Task[]) {
  const own = tasks.filter((t) => t.status !== 'cancelled');
  if (!own.length) return 0;
  let w = 0, s = 0;
  for (const t of own) {
    const weight = Math.max(1, durationDays(t));
    w += weight;
    s += weight * (t.status === 'completed' ? 100 : t.progress);
  }
  return Math.round(s / w);
}

/**
 * Builds the hierarchical row list: Project → Phase → Task → Subtask.
 * Summary rows (project, phase) span their children. Collapsed group keys
 * hide descendants.
 */
export function buildGanttRows(
  data: PlannerData,
  tasks: Task[],
  today: ISODate,
  collapsed: Set<string> = new Set(),
): GanttRow[] {
  const rows: GanttRow[] = [];
  const included = new Set(tasks.map((t) => t.id));
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t.projectId && data.projects.some((p) => p.id === t.projectId) ? t.projectId : NO_PROJECT;
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k)!.push(t);
  }
  const projectOrder = [...data.projects]
    .filter((p) => byProject.has(p.id))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
  const sortT = (a: Task, b: Task) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate) || a.title.localeCompare(b.title);

  const pushTaskTree = (list: Task[], depth: number, wbsPrefix: string, groupKey: string, offset = 0) => {
    // Roots are tasks whose parent is absent from the current set.
    const roots = list.filter((t) => !t.parentTaskId || !included.has(t.parentTaskId) || !list.some((x) => x.id === t.parentTaskId)).sort(sortT);
    const walk = (t: Task, d: number, wbs: string) => {
      const children = list.filter((c) => c.parentTaskId === t.id).sort(sortT);
      rows.push({
        key: t.id, kind: 'task', depth: d, label: t.title, start: t.startDate, end: t.endDate,
        progress: t.status === 'completed' ? 100 : t.progress, task: t, state: taskState(t, today),
        wbs, hasChildren: children.length > 0, groupKey,
      });
      if (collapsed.has(t.id)) return;
      children.forEach((c, i) => walk(c, d + 1, `${wbs}.${i + 1}`));
    };
    roots.forEach((t, i) => walk(t, depth, `${wbsPrefix}${i + 1 + offset}`));
  };

  const projectKeys: string[] = projectOrder.map((p) => p.id);
  if (byProject.has(NO_PROJECT)) projectKeys.push(NO_PROJECT);

  projectKeys.forEach((pk, pi) => {
    const ptasks = byProject.get(pk)!;
    const project = data.projects.find((p) => p.id === pk);
    const sp = span(ptasks)!;
    const pkey = `p:${pk}`;
    rows.push({
      key: pkey, kind: 'project', depth: 0, label: project ? project.name : 'Tasks without a project',
      start: sp[0], end: sp[1], progress: avgProgress(ptasks), project, wbs: `${pi + 1}`, hasChildren: true,
    });
    if (collapsed.has(pkey)) return;
    const phases = data.phases.filter((ph) => ph.projectId === pk).sort((a, b) => a.order - b.order);
    let n = 0;
    for (const ph of phases) {
      const phTasks = ptasks.filter((t) => t.phaseId === ph.id);
      if (!phTasks.length) continue;
      n++;
      const s = span(phTasks)!;
      const phKey = `ph:${ph.id}`;
      rows.push({
        key: phKey, kind: 'phase', depth: 1, label: ph.name, start: s[0], end: s[1],
        progress: avgProgress(phTasks), phase: ph, project, wbs: `${pi + 1}.${n}`, hasChildren: true,
      });
      if (!collapsed.has(phKey)) pushTaskTree(phTasks, 2, `${pi + 1}.${n}.`, phKey);
    }
    const loose = ptasks.filter((t) => !t.phaseId || !phases.some((ph) => ph.id === t.phaseId));
    if (loose.length) pushTaskTree(loose, 1, `${pi + 1}.`, pkey, n);
  });
  return rows;
}

/* ---------------- Timeline scale ---------------- */

export const PX_PER_DAY: Record<GanttZoom, number> = { day: 34, week: 14, month: 4.2, quarter: 1.6 };

/** Snap the visible range outward to whole units of the zoom level, with padding. */
export function timelineRange(rows: { start: ISODate; end: ISODate }[], zoom: GanttZoom, today: ISODate, from?: ISODate | '', to?: ISODate | '') {
  let start: ISODate, end: ISODate;
  if (rows.length) {
    const ds = rows.flatMap((r) => [r.start, r.end]).sort();
    start = ds[0];
    end = ds[ds.length - 1];
  } else {
    start = today;
    end = addDays(today, 30);
  }
  if (from) start = from;
  if (to) end = to;
  const pad = { day: 3, week: 7, month: 14, quarter: 30 }[zoom];
  start = addDays(start, -pad);
  end = addDays(end, pad + { day: 14, week: 21, month: 30, quarter: 60 }[zoom]); // room to drag tasks later
  if (zoom === 'day' || zoom === 'week') {
    start = startOfWeek(start, 1);
    end = addDays(startOfWeek(end, 1), 6);
  } else {
    const ps = parts(start);
    const pe = parts(end);
    const qs = zoom === 'quarter' ? Math.floor(ps.month / 3) * 3 : ps.month;
    start = makeDate(ps.year, qs, 1);
    const endMonth = zoom === 'quarter' ? Math.floor(pe.month / 3) * 3 + 3 : pe.month + 1;
    end = addDays(makeDate(pe.year, endMonth, 1), -1);
  }
  // Ensure a minimum width so short plans still fill the screen.
  const minDays = { day: 35, week: 84, month: 365, quarter: 730 }[zoom];
  if (toEpochDay(end) - toEpochDay(start) + 1 < minDays) end = addDays(start, minDays - 1);
  return { start, end, days: toEpochDay(end) - toEpochDay(start) + 1 };
}

export interface HeaderCell { label: string; startDay: number; days: number; title?: string }

/** Two header bands (upper, lower) for the timeline at the given zoom. */
export function timelineHeaders(start: ISODate, days: number, zoom: GanttZoom): { upper: HeaderCell[]; lower: HeaderCell[]; letters: HeaderCell[] } {
  const s0 = toEpochDay(start);
  const upper: HeaderCell[] = [];
  const lower: HeaderCell[] = [];
  const letters: HeaderCell[] = [];
  const pushRun = (arr: HeaderCell[], keyOf: (d: ISODate) => string, labelOf: (d: ISODate) => string, titleOf?: (d: ISODate) => string) => {
    let curKey = '';
    for (let i = 0; i < days; i++) {
      const d = fromEpochDay(s0 + i);
      const k = keyOf(d);
      if (k !== curKey) {
        arr.push({ label: labelOf(d), startDay: i, days: 1, title: titleOf?.(d) });
        curKey = k;
      } else arr[arr.length - 1].days++;
    }
  };
  const monthKey = (d: ISODate) => d.slice(0, 7);
  const monthLabel = (d: ISODate) => `${MONTHS_SHORT[parts(d).month]} ${parts(d).year}`;
  const yearKey = (d: ISODate) => d.slice(0, 4);
  if (zoom === 'day') {
    // Weekly date bands over day numbers and weekday initials (classic Excel Gantt layout).
    pushRun(upper, (d) => startOfWeek(d, 1), (d) => `${parts(d).day} ${MONTHS_SHORT[parts(d).month]} ${parts(d).year}`, (d) => `Week of ${d}`);
    pushRun(lower, (d) => d, (d) => String(parts(d).day), (d) => d);
    pushRun(letters, (d) => d, (d) => 'SMTWTFS'[weekday(d)]);
  } else if (zoom === 'week') {
    pushRun(upper, monthKey, monthLabel);
    pushRun(lower, (d) => startOfWeek(d, 1), (d) => `W${isoWeek(d)}`, (d) => `Week of ${startOfWeek(d, 1)}`);
  } else if (zoom === 'month') {
    pushRun(upper, yearKey, yearKey);
    pushRun(lower, monthKey, (d) => MONTHS_SHORT[parts(d).month]);
  } else {
    pushRun(upper, yearKey, yearKey);
    pushRun(lower, (d) => `${d.slice(0, 4)}Q${Math.floor(parts(d).month / 3)}`, (d) => `Q${Math.floor(parts(d).month / 3) + 1}`);
  }
  return { upper, lower, letters };
}

/* ---------------- Colours (shared by the app chart and the Excel export) ---------------- */

export function phaseColor(phase: Phase, data: Pick<PlannerData, 'phases'>): string {
  if (phase.color) return phase.color;
  const siblings = data.phases.filter((p) => p.projectId === phase.projectId).sort((a, b) => a.order - b.order);
  const i = Math.max(0, siblings.findIndex((p) => p.id === phase.id));
  return PHASE_PALETTE[i % PHASE_PALETTE.length];
}

/** Bar colour for a task: its phase colour in "phase" mode (falling back to category), else its category colour. */
export function barColor(t: Task, data: PlannerData): string {
  if (data.settings.ganttColorBy === 'phase' && t.phaseId) {
    const ph = data.phases.find((p) => p.id === t.phaseId);
    if (ph) return phaseColor(ph, data);
  }
  return (data.categories.find((c) => c.id === t.categoryId) ?? data.categories[data.categories.length - 1]).color;
}
