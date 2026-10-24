import { useMemo, useState } from 'react';
import { ICheck, IEdit, IGantt, IPlus, ISearch, ITrash } from '../../components/Icons';
import { useEditor } from '../../components/TaskEditor';
import { CategoryChip, PriorityBadge, StatusBadge, useConfirm } from '../../components/ui';
import { useStore } from '../../data/store';
import { addDays, fmtDate, fmtTime, relativeDay } from '../../domain/dates';
import { bucket, isOverdue, matchesFilter, sortTasks, subtreeIds, type TaskFilter, type TaskSort } from '../../domain/tasks';
import type { Priority, Task, TaskStatus } from '../../domain/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../domain/types';

type Tab = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All tasks' }, { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' }, { id: 'completed', label: 'Completed' },
];

export function TasksPage() {
  const store = useStore();
  const { data, today } = store;
  const { openNew } = useEditor();
  const [tab, setTab] = useState<Tab>('all');
  const [f, setF] = useState<TaskFilter>({ text: '', categoryIds: [], projectId: '', priority: '', status: '', from: '', to: '' });
  const [sort, setSort] = useState<TaskSort>('due');

  const inTab = (t: Task, tb: Tab) => {
    const b = bucket(t, today, data.settings.weekStartsOn);
    switch (tb) {
      case 'today': return b.today;
      case 'upcoming': return b.upcoming;
      case 'overdue': return b.overdue;
      case 'completed': return b.completed;
      default: return true;
    }
  };
  const filtered = useMemo(() => data.tasks.filter((t) => matchesFilter(t, f)), [data.tasks, f]);
  const list = useMemo(() => sortTasks(filtered.filter((t) => inTab(t, tab)), sort, data.projects), [filtered, tab, sort, data.projects, today]);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, filtered.filter((x) => inTab(x, t.id)).length]));
  const anyFilter = !!(f.text || f.categoryIds?.length || f.projectId || f.priority || f.status || f.from || f.to);

  return (
    <div className="page">
      <div className="tabs" role="tablist" aria-label="Task views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
            {t.label}<span className="n" style={t.id === 'overdue' && counts.overdue ? { background: 'var(--peach)', color: 'var(--peach-ink)' } : undefined}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="filters" role="search" aria-label="Filter tasks">
        <div className="search">
          <ISearch size={15} />
          <input className="input" placeholder="Search title or description" aria-label="Search tasks" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        </div>
        <select className="select select-sm" aria-label="Category" value={f.categoryIds?.[0] ?? ''} onChange={(e) => setF({ ...f, categoryIds: e.target.value ? [e.target.value] : [] })}>
          <option value="">All categories</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select select-sm" aria-label="Project" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
          <option value="">All projects</option>
          <option value="none">No project</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="select select-sm" aria-label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="">Any priority</option>
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="select select-sm" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="hstack" style={{ gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>From
          <input type="date" className="input input-sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From date" />
        </label>
        <label className="hstack" style={{ gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>To
          <input type="date" className="input input-sm" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To date" />
        </label>
        <select className="select select-sm" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as TaskSort)}>
          <option value="due">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Newest first</option>
          <option value="project">Sort: Project</option>
        </select>
        {anyFilter && <button className="btn btn-sm btn-ghost" onClick={() => setF({ text: '', categoryIds: [], projectId: '', priority: '', status: '', from: '', to: '' })}>Clear filters</button>}
      </div>

      <div className="card">
        {list.length === 0 ? (
          <div className="empty">
            <h3>{anyFilter ? 'No tasks match these filters' : tab === 'overdue' ? 'Nothing overdue' : tab === 'completed' ? 'No completed tasks yet' : tab === 'today' ? 'Nothing scheduled today' : 'No tasks yet'}</h3>
            <p>{anyFilter ? 'Try clearing a filter or widening the date range.' : 'Add a task here or click a date on the calendar.'}</p>
            <button className="btn btn-soft" onClick={() => openNew({ startDate: tab === 'upcoming' ? addDays(today, 1) : today })}><IPlus size={14} />Add task</button>
          </div>
        ) : (
          <div className="task-list" role="list">
            {list.map((t) => <TaskRow key={t.id} t={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskRow({ t, compact }: { t: Task; compact?: boolean }) {
  const store = useStore();
  const { data, today } = store;
  const { openTask } = useEditor();
  const confirm = useConfirm();
  const cat = data.categories.find((c) => c.id === t.categoryId) ?? data.categories[0];
  const project = data.projects.find((p) => p.id === t.projectId);
  const done = t.status === 'completed';
  const overdue = isOverdue(t, today);

  const toggleDone = () => {
    store.setTaskStatus(t.id, done ? 'in_progress' : 'completed');
    if (!done) store.notify('success', `Completed “${t.title}”`, { label: 'Undo', run: () => store.saveTask(t) });
  };
  const del = async () => {
    const n = subtreeIds(data.tasks, t.id).length - 1;
    const r = await confirm({ title: `Delete “${t.title}”?`, message: n ? `This also deletes ${n} subtask${n > 1 ? 's' : ''}.` : 'This cannot be undone after you leave this page.', confirmLabel: 'Delete', danger: true });
    if (r !== 'confirm') return;
    const snapshot = data.tasks.filter((x) => subtreeIds(data.tasks, t.id).includes(x.id) || x.dependencyIds.includes(t.id));
    store.deleteTask(t.id);
    store.notify('info', `Deleted “${t.title}”`, { label: 'Undo', run: () => snapshot.forEach((x) => store.saveTask(x)) });
  };

  return (
    <div className={`task-row ${done ? 'done' : ''}`} role="listitem">
      <button className="check" role="checkbox" aria-checked={done} aria-label={done ? `Mark “${t.title}” as not complete` : `Mark “${t.title}” complete`} onClick={toggleDone}><ICheck size={13} /></button>
      <button className="task-main" onClick={() => openTask(t.id)}>
        <span className="task-title">{t.isMilestone && '◆ '}{t.title}</span>
        <span className="task-meta">
          <CategoryChip cat={cat} />
          <span className="mono">{t.startDate === t.endDate ? fmtDate(t.startDate) : `${fmtDate(t.startDate, { year: false })} → ${fmtDate(t.endDate)}`}{!t.allDay && ` · ${fmtTime(t.startTime)}`}</span>
          {!done && <span>{relativeDay(t.endDate, today)}</span>}
          {project && <span>· {project.name}</span>}
          {t.includeInGantt && <span title="Included in the Gantt chart" style={{ display: 'inline-flex' }}><IGantt size={12} /></span>}
          {t.isExample && <span className="badge example">Example</span>}
        </span>
      </button>
      {!compact && (
        <div className="task-actions">
          <PriorityBadge p={t.priority} />
          <StatusBadge t={t} overdue={overdue} />
          <select className="select select-sm" aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => store.setTaskStatus(t.id, e.target.value as TaskStatus)}>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="icon-btn" aria-label={`Edit ${t.title}`} onClick={() => openTask(t.id)}><IEdit size={15} /></button>
          <button className="icon-btn" aria-label={`Delete ${t.title}`} onClick={del}><ITrash size={15} /></button>
        </div>
      )}
    </div>
  );
}
