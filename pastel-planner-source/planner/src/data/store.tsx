import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyData } from '../domain/defaults';
import { todayISO } from '../domain/dates';
import { applyStatus, dependencyIssues, newTask, nowISO, subtreeIds, uid, type DependencyIssue } from '../domain/tasks';
import { autoSchedule, fitPhases, shiftWithSubtasks } from '../domain/schedule';
import { diffDays } from '../domain/dates';
import type { Category, ISODate, Phase, PlannerData, Project, Settings, Task, TaskStatus } from '../domain/types';
import { exampleData } from './seed';
import { normalize, selectAdapter, type Collection, type StorageAdapter } from './storage';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface Toast { id: string; kind: ToastKind; message: string; action?: { label: string; run: () => void } }

interface Store {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  storageLabel: string;
  storageKind: StorageAdapter['kind'] | null;
  data: PlannerData;
  today: ISODate;
  toasts: Toast[];
  notify(kind: ToastKind, message: string, action?: Toast['action']): void;
  dismissToast(id: string): void;
  /** Saves a task; with auto-scheduling on, linked tasks, parents and phases follow. */
  saveTask(t: Task, opts?: { relinked?: boolean; quiet?: boolean }): Task;
  /** Puts records back exactly as given (used by Undo), without re-running the schedule. */
  restore(snapshot: { tasks: Task[]; phases: Phase[] }): void;
  deleteTask(id: string): number;
  duplicateTask(id: string): Task | null;
  setTaskStatus(id: string, status: TaskStatus): void;
  rescheduleTask(id: string, start: ISODate, end: ISODate): DependencyIssue[];
  setBaseline(ids: string[]): void;
  saveProject(p: Project): void;
  deleteProject(id: string, mode: 'delete_tasks' | 'keep_tasks'): void;
  savePhase(p: Phase): void;
  deletePhase(id: string): void;
  saveCategory(c: Category): void;
  deleteCategory(id: string): void;
  saveSettings(patch: Partial<Settings>): void;
  replaceAll(d: PlannerData): Promise<void>;
  /** True while the practice copy of the example planner is shown. Nothing is saved in this mode. */
  demo: boolean;
  /** Show the example planner as a separate practice copy; your own data is set aside untouched. */
  enterExample(): void;
  /** Leave the example and return to your own planner exactly as it was. */
  exitExample(): void;
  /** Remove example records that were mixed into your own planner by an older version. */
  removeExamples(): void;
}

const Ctx = createContext<Store | null>(null);

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PlannerData>(emptyData);
  const [status, setStatus] = useState<Store['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [today, setToday] = useState(todayISO());
  const adapterRef = useRef<StorageAdapter | null>(null);
  const dataRef = useRef(data);
  // Example ("practice") mode: the real data is parked here and nothing is written to storage.
  const [demo, setDemo] = useState(false);
  const demoRef = useRef(false);
  const realRef = useRef<PlannerData | null>(null);
  dataRef.current = data;

  const notify = useCallback((kind: ToastKind, message: string, action?: Toast['action']) => {
    const id = uid('n');
    setToasts((ts) => [...ts.slice(-3), { id, kind, message, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const adapter = await selectAdapter();
        adapterRef.current = adapter;
        const loaded = await adapter.load();
        if (!alive) return;
        setData(normalize(loaded));
        setStatus('ready');
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? 'Could not load your planner.');
        setStatus('error');
      }
    })();
    // Keep "today" correct if the app stays open past midnight.
    const timer = setInterval(() => setToday(todayISO()), 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  /** Persist helper: failures surface as an error toast; state stays optimistic. */
  const persist = useCallback((p: Promise<void> | undefined) => {
    p?.catch((e: any) => {
      const msg = e?.code === 'quota_exceeded'
        ? 'Storage is full. Delete some old tasks or export a backup, then try again.'
        : `Couldn't save your change: ${e?.message ?? 'unknown error'}. Export a backup from Settings if this keeps happening.`;
      notify('error', msg);
    });
  }, [notify]);

  const put = useCallback((c: Collection, item: any) => { if (!demoRef.current) persist(adapterRef.current?.put(c, item)); }, [persist]);
  const remove = useCallback((c: Collection, id: string) => { if (!demoRef.current) persist(adapterRef.current?.remove(c, id)); }, [persist]);

  const upsert = <T extends { id: string }>(list: T[], item: T) => {
    const i = list.findIndex((x) => x.id === item.id);
    if (i < 0) return [...list, item];
    const copy = [...list];
    copy[i] = item;
    return copy;
  };

  const store = useMemo<Store>(() => {
    /** Update state and the ref together so back-to-back mutations never see stale data. */
    const commit = (next: PlannerData) => { dataRef.current = next; setData(next); };
    const mutate = (fn: (d: PlannerData) => PlannerData) => commit(fn(dataRef.current));
    /**
     * Applies a new task list. With auto-scheduling on, linked successors,
     * summary tasks and phases are recalculated and persisted too, and the
     * user gets one notice (with Undo) describing what moved.
     */
    const applyTasks = (nextTasks: Task[], edited: string[], opts: { relinked?: boolean; quiet?: boolean } = {}) => {
      const d = dataRef.current;
      const before = { tasks: d.tasks, phases: d.phases };
      let tasks = nextTasks;
      let moved: Task[] = [];
      let phaseChanges: Phase[] = [];
      if (d.settings.autoSchedule) {
        const res = autoSchedule(nextTasks, edited, { relinked: opts.relinked, previous: d.tasks });
        const changedIds = new Set(res.changed.map((t) => t.id));
        const ts = nowISO();
        tasks = res.tasks.map((t) => (changedIds.has(t.id) ? { ...t, updatedAt: ts } : t));
        moved = tasks.filter((t) => changedIds.has(t.id));
        phaseChanges = fitPhases(d.phases, tasks);
      }
      const phases = d.phases.map((p) => phaseChanges.find((x) => x.id === p.id) ?? p);
      commit({ ...d, tasks, phases });
      const editedSet = new Set(edited);
      tasks.filter((t) => editedSet.has(t.id)).forEach((t) => put('tasks', t));
      moved.forEach((t) => put('tasks', t));
      phaseChanges.forEach((p) => put('phases', p));
      const dateMoves = moved.filter((t) => { const o = before.tasks.find((x) => x.id === t.id); return o && (o.startDate !== t.startDate || o.endDate !== t.endDate); });
      if (dateMoves.length && !opts.quiet) {
        notify('info', `Linked schedule updated: ${dateMoves.length} dependent task${dateMoves.length > 1 ? 's' : ''} moved (${dateMoves.slice(0, 3).map((t) => `“${t.title}”`).join(', ')}${dateMoves.length > 3 ? '…' : ''}).`,
          { label: 'Undo all', run: () => restoreSnap(before) });
      }
      return tasks;
    };
    const restoreSnap = (snap: { tasks: Task[]; phases: Phase[] }) => {
      const d = dataRef.current;
      const cur = new Map(d.tasks.map((t) => [t.id, t]));
      commit({ ...d, tasks: snap.tasks, phases: snap.phases });
      for (const t of snap.tasks) if (cur.get(t.id) !== t) put('tasks', t);
      for (const t of d.tasks) if (!snap.tasks.some((x) => x.id === t.id)) remove('tasks', t.id);
      for (const p of snap.phases) if (!d.phases.includes(p)) put('phases', p);
    };
    const saveTask = (t: Task, opts: { relinked?: boolean; quiet?: boolean } = {}) => {
      const saved = { ...t, updatedAt: nowISO(), progress: Math.round(t.progress) };
      if (saved.isMilestone) saved.endDate = saved.startDate;
      const tasks = applyTasks(upsert(dataRef.current.tasks, saved), [saved.id], opts);
      return tasks.find((x) => x.id === saved.id) ?? saved;
    };

    return {
      status, error, data, today, toasts, notify, dismissToast,
      storageLabel: adapterRef.current?.label ?? '',
      storageKind: adapterRef.current?.kind ?? null,

      saveTask,
      restore: restoreSnap,

      deleteTask(id) {
        const d = dataRef.current;
        const ids = new Set(subtreeIds(d.tasks, id));
        const touched: Task[] = [];
        const tasks = d.tasks
          .filter((t) => !ids.has(t.id))
          .map((t) => {
            if (t.dependencyIds.some((x) => ids.has(x))) {
              const u = { ...t, dependencyIds: t.dependencyIds.filter((x) => !ids.has(x)), updatedAt: nowISO() };
              touched.push(u);
              return u;
            }
            return t;
          });
        commit({ ...d, tasks });
        ids.forEach((x) => remove('tasks', x));
        touched.forEach((t) => put('tasks', t));
        applyTasks(tasks, [], { quiet: true }); // summary tasks and phases re-fit
        return ids.size;
      },

      duplicateTask(id) {
        const src = dataRef.current.tasks.find((t) => t.id === id);
        if (!src) return null;
        const copy = newTask({
          ...src, id: uid('t'), title: `${src.title} (copy)`, createdAt: nowISO(), completedAt: null,
          status: src.status === 'completed' ? 'not_started' : src.status, progress: src.status === 'completed' ? 0 : src.progress,
          actualStart: null, actualEnd: null, baselineStart: null, baselineEnd: null, isExample: false, reminderDismissed: false,
        });
        return saveTask(copy);
      },

      setTaskStatus(id, st) {
        const t = dataRef.current.tasks.find((x) => x.id === id);
        if (!t) return;
        const next = applyStatus(t, st, todayISO());
        saveTask(next);
        const issues = dependencyIssues(next, dataRef.current.tasks).filter((i) => i.kind === 'predecessor_incomplete');
        if (issues.length) notify('warning', issues[0].message);
      },

      rescheduleTask(id, start, end) {
        const t = dataRef.current.tasks.find((x) => x.id === id);
        if (!t) return [];
        const kids = dataRef.current.tasks.some((x) => x.parentTaskId === id);
        let next: Task;
        if (kids) {
          // Moving a summary task moves its subtasks; the summary then re-fits around them.
          const delta = diffDays(t.startDate, start);
          const shifted = shiftWithSubtasks(dataRef.current.tasks, id, delta);
          const editedIds = subtreeIds(shifted, id);
          applyTasks(shifted.map((x) => (editedIds.includes(x.id) ? { ...x, updatedAt: nowISO() } : x)), editedIds);
          next = dataRef.current.tasks.find((x) => x.id === id)!;
        } else next = saveTask({ ...t, startDate: start, endDate: t.isMilestone ? start : end });
        const others = dataRef.current.tasks.map((x) => (x.id === id ? next : x));
        const issues = dependencyIssues(next, others).filter((i) => i.kind === 'starts_before_finish');
        // Successors that now start before this task finishes.
        for (const s of others.filter((x) => x.dependencyIds.includes(id))) {
          issues.push(...dependencyIssues(s, others).filter((i) => i.kind === 'starts_before_finish' && i.predecessor.id === id)
            .map((i) => ({ ...i, message: `“${s.title}” now starts before “${next.title}” finishes.` })));
        }
        return issues;
      },

      setBaseline(ids) {
        const set = new Set(ids);
        const now = nowISO();
        const d = dataRef.current;
        const changed: Task[] = [];
        const tasks = d.tasks.map((t) => {
          if (!set.has(t.id)) return t;
          const u = { ...t, baselineStart: t.startDate, baselineEnd: t.endDate, updatedAt: now };
          changed.push(u);
          return u;
        });
        commit({ ...d, tasks });
        changed.forEach((t) => put('tasks', t));
      },

      saveProject(p) {
        const saved = { ...p, updatedAt: nowISO() };
        mutate((d) => ({ ...d, projects: upsert(d.projects, saved) }));
        put('projects', saved);
      },

      deleteProject(id, mode) {
        const d = dataRef.current;
        const projTasks = d.tasks.filter((t) => t.projectId === id);
        const projTaskIds = new Set(projTasks.map((t) => t.id));
        let tasks: Task[];
        const touched: Task[] = [];
        if (mode === 'delete_tasks') {
          tasks = d.tasks.filter((t) => !projTaskIds.has(t.id)).map((t) => {
            if (t.dependencyIds.some((x) => projTaskIds.has(x)) || (t.parentTaskId && projTaskIds.has(t.parentTaskId))) {
              const u = { ...t, dependencyIds: t.dependencyIds.filter((x) => !projTaskIds.has(x)), parentTaskId: t.parentTaskId && projTaskIds.has(t.parentTaskId) ? null : t.parentTaskId, updatedAt: nowISO() };
              touched.push(u);
              return u;
            }
            return t;
          });
          projTaskIds.forEach((x) => remove('tasks', x));
        } else {
          // Keep tasks as standalone items; FS dependencies were project-scoped, so clear them.
          tasks = d.tasks.map((t) => {
            if (!projTaskIds.has(t.id)) return t;
            const u = { ...t, projectId: null, phaseId: null, dependencyIds: [], updatedAt: nowISO() };
            touched.push(u);
            return u;
          });
        }
        const phases = d.phases.filter((p) => p.projectId === id);
        commit({ ...d, tasks, projects: d.projects.filter((p) => p.id !== id), phases: d.phases.filter((p) => p.projectId !== id) });
        touched.forEach((t) => put('tasks', t));
        phases.forEach((p) => remove('phases', p.id));
        remove('projects', id);
      },

      savePhase(p) {
        mutate((d) => ({ ...d, phases: upsert(d.phases, p) }));
        put('phases', p);
      },

      deletePhase(id) {
        const d = dataRef.current;
        const touched: Task[] = [];
        const tasks = d.tasks.map((t) => {
          if (t.phaseId !== id) return t;
          const u = { ...t, phaseId: null, updatedAt: nowISO() };
          touched.push(u);
          return u;
        });
        commit({ ...d, tasks, phases: d.phases.filter((p) => p.id !== id) });
        touched.forEach((t) => put('tasks', t));
        remove('phases', id);
      },

      saveCategory(c) {
        mutate((d) => ({ ...d, categories: upsert(d.categories, c).sort((a, b) => a.order - b.order) }));
        put('categories', c);
      },

      deleteCategory(id) {
        mutate((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }));
        remove('categories', id);
      },

      saveSettings(patch) {
        const next = { ...dataRef.current.settings, ...patch };
        mutate((d) => ({ ...d, settings: next }));
        if (!demoRef.current) persist(adapterRef.current?.putSettings(next));
      },

      async replaceAll(next) {
        const n = normalize(next);
        commit(n);
        if (!demoRef.current) await adapterRef.current?.replaceAll(n);
      },

      demo,

      enterExample() {
        if (demoRef.current) return;
        realRef.current = dataRef.current;
        demoRef.current = true;
        const real = dataRef.current;
        const ex = exampleData(todayISO());
        setDemo(true);
        commit({ ...emptyData(), ...ex, categories: real.categories, settings: { ...real.settings, onboarded: true } });
      },

      exitExample() {
        if (!demoRef.current) return;
        demoRef.current = false;
        setDemo(false);
        if (realRef.current) commit(realRef.current);
        realRef.current = null;
      },

      removeExamples() {
        const d = dataRef.current;
        const exProjects = new Set(d.projects.filter((p) => p.isExample).map((p) => p.id));
        const exTasks = new Set(d.tasks.filter((t) => t.isExample).map((t) => t.id));
        const keepTasks = d.tasks.filter((t) => !exTasks.has(t.id)).map((t) => {
          if (t.projectId && exProjects.has(t.projectId)) return { ...t, projectId: null, phaseId: null, dependencyIds: [] };
          if (t.dependencyIds.some((x) => exTasks.has(x)) || (t.parentTaskId && exTasks.has(t.parentTaskId))) {
            return { ...t, dependencyIds: t.dependencyIds.filter((x) => !exTasks.has(x)), parentTaskId: t.parentTaskId && exTasks.has(t.parentTaskId) ? null : t.parentTaskId };
          }
          return t;
        });
        const exPhases = d.phases.filter((p) => exProjects.has(p.projectId));
        commit({ ...d, tasks: keepTasks, projects: d.projects.filter((p) => !exProjects.has(p.id)), phases: d.phases.filter((p) => !exProjects.has(p.projectId)) });
        exTasks.forEach((id) => remove('tasks', id));
        exPhases.forEach((p) => remove('phases', p.id));
        exProjects.forEach((id) => remove('projects', id));
        keepTasks.forEach((t) => { const old = d.tasks.find((o) => o.id === t.id); if (old !== t) put('tasks', t); });
      },
    };
  }, [status, error, data, today, toasts, notify, dismissToast, put, remove, persist, demo]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** Convenience selectors */
export function useCategory() {
  const { data } = useStore();
  return useCallback((id: string) => data.categories.find((c) => c.id === id) ?? data.categories[data.categories.length - 1], [data.categories]);
}
