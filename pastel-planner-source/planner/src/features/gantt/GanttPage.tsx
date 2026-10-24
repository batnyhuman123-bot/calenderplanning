import { useMemo, useState } from 'react';
import { IBaseline, IChevL, IChevR, IDownload, IGantt, IPlus } from '../../components/Icons';
import { useEditor } from '../../components/TaskEditor';
import { catVars, useConfirm } from '../../components/ui';
import { useStore } from '../../data/store';
import { addDays, fmtDate, startOfWeek } from '../../domain/dates';
import { barColor, buildGanttRows, ganttTasks, phaseColor, timelineRange, type GanttFilter, type GanttRow } from '../../domain/gantt';
import type { GanttZoom, ISODate, Task, TaskStatus } from '../../domain/types';
import { STATUS_LABEL } from '../../domain/types';
import { saveFile, stamp } from '../../export/download';
import { GanttChart } from './GanttChart';

/** Hook bundling the shared Gantt behaviour (used by Gantt Chart View and the project page). */
export function useGanttController(filter: GanttFilter) {
  const store = useStore();
  const { data, today } = store;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tasks = useMemo(() => ganttTasks(data, filter), [data, filter]);
  const rows = useMemo(() => buildGanttRows(data, tasks, today, collapsed), [data, tasks, today, collapsed]);
  const toggle = (k: string) => setCollapsed((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const reschedule = (id: string, s: ISODate, e: ISODate) => {
    const before = data.tasks.find((t) => t.id === id);
    if (!before) return;
    const issues = store.rescheduleTask(id, s, e);
    const undo = { label: 'Undo', run: () => store.saveTask(before) };
    if (issues.length) store.notify('warning', `Dependency warning: ${issues[0].message}`, undo);
    else store.notify('success', `“${before.title}” moved to ${fmtDate(s, { year: false })}${s !== e ? ` – ${fmtDate(e, { year: false })}` : ''}`, undo);
  };
  const colorOf = (t: Task) => barColor(t, data);
  const rowColor = (r: GanttRow) => (r.kind === 'phase' && r.phase && data.settings.ganttColorBy === 'phase' ? phaseColor(r.phase, data) : r.kind === 'project' ? '#F3EEFB' : undefined);
  return { tasks, rows, collapsed, toggle, reschedule, colorOf, rowColor };
}

/** "Display week" control from the classic Excel Gantt: jump the timeline week by week from the project start. */
export function useDisplayWeek(projectStart: ISODate) {
  const [week, setWeek] = useState(1);
  const [nonce, setNonce] = useState(0);
  const go = (w: number) => { const n = Math.max(1, w); setWeek(n); setNonce((x) => x + 1); };
  const date = addDays(startOfWeek(projectStart, 1), (week - 1) * 7);
  return { week, go, scrollTo: nonce ? { date, nonce } : undefined, date };
}

export function DisplayWeek({ projectStart, ctl }: { projectStart: ISODate; ctl: ReturnType<typeof useDisplayWeek> }) {
  return (
    <div className="display-week" role="group" aria-label="Display week">
      <span className="dw-k">Project start</span><span className="dw-v mono">{fmtDate(projectStart)}</span>
      <span className="dw-k">Display week</span>
      <button className="icon-btn" aria-label="Previous week" onClick={() => ctl.go(ctl.week - 1)} disabled={ctl.week <= 1}><IChevL size={14} /></button>
      <input className="input input-sm mono" style={{ width: 52, textAlign: 'center' }} type="number" min={1} aria-label="Display week number" value={ctl.week} onChange={(e) => ctl.go(Number(e.target.value) || 1)} />
      <button className="icon-btn" aria-label="Next week" onClick={() => ctl.go(ctl.week + 1)}><IChevR size={14} /></button>
      <span className="dw-k mono">{fmtDate(ctl.date, { year: false })}</span>
    </div>
  );
}

export function GanttLegend({ milestoneColor, rows }: { milestoneColor: string; rows?: GanttRow[] }) {
  const { data } = useStore();
  const byPhase = data.settings.ganttColorBy === 'phase';
  const swatches: { key: string; name: string; color: string }[] = byPhase
    ? [...new Map((rows ?? []).filter((r) => r.kind === 'phase' && r.phase).map((r) => [r.phase!.name, { key: r.key, name: r.phase!.name, color: phaseColor(r.phase!, data) }])).values()]
    : data.categories.filter((c) => c.isActive).map((c) => ({ key: c.id, name: c.name, color: c.color }));
  return (
    <div className="gantt-legend" aria-label="Legend">
      {swatches.map((c) => (
        <span key={c.key} className="lg"><span style={{ ...catVars(c.color), width: 22, height: 10, borderRadius: 3, background: c.color, border: '1px solid var(--bar-stroke)', display: 'inline-block' }} />{c.name}</span>
      ))}
      {byPhase && <span className="lg muted">Tasks without a phase use their category colour</span>}
      <span className="lg"><span style={{ width: 22, height: 10, borderRadius: 3, background: 'linear-gradient(90deg, #A9C6EE 55%, #D9E8FC 55%)', display: 'inline-block', border: '1px solid #9DB9E3' }} />Progress fill</span>
      <span className="lg"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l5 5-5 5-5-5z" fill={milestoneColor} stroke="#C99A3E" strokeWidth="1.3" /></svg>Milestone</span>
      <span className="lg"><svg width="26" height="10" aria-hidden="true"><path d="M1 5h20" stroke="#9C94A3" strokeWidth="1.3" /><path d="M19 1l5 4-5 4z" fill="#9C94A3" /></svg>Dependency</span>
      <span className="lg"><svg width="26" height="10" aria-hidden="true"><path d="M1 5h20" stroke="#B0413E" strokeWidth="1.3" strokeDasharray="4 3" /><path d="M19 1l5 4-5 4z" fill="#B0413E" /></svg>Dependency conflict</span>
      <span className="lg"><span style={{ width: 22, height: 10, borderRadius: 3, border: '1.5px dashed var(--danger)', display: 'inline-block' }} />Blocked</span>
      <span className="lg"><span style={{ width: 22, height: 10, borderRadius: 3, border: '1.5px solid var(--peach-ink)', display: 'inline-block' }} />Overdue</span>
      <span className="lg"><span style={{ width: 10, height: 14, background: 'rgba(168,80,111,.14)', borderLeft: '2px solid var(--today)', display: 'inline-block' }} />Today</span>
    </div>
  );
}

/** Excel export shared by the overview and each project workspace. */
export function useGanttExport() {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const run = async (tasks: Task[], scopeLabel: string, fileLabel = scopeLabel) => {
    if (!tasks.length) { store.notify('warning', 'Nothing to export yet. Add a task to this Gantt chart first.'); return; }
    setBusy(true);
    try {
      const { exportGanttXlsx } = await import('../../export/excel');
      const blob = await exportGanttXlsx(store.data, tasks, { today: store.today, scopeLabel });
      const safe = fileLabel.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Gantt';
      const name = `Gantt-${safe}-${stamp()}.xlsx`;
      const outcome = await saveFile(name, blob);
      if (outcome === 'saved') { setLast(`${name} · ${tasks.length} task${tasks.length > 1 ? 's' : ''}`); store.notify('success', `Exported ${name}. It's a snapshot: export again after you make changes.`); }
      else if (outcome === 'declined') store.notify('info', 'Download cancelled.');
      else store.notify('error', 'Downloads are not available in this view. Open the planner in the Claude app or a browser tab and try again.');
    } catch (e: any) {
      store.notify('error', `Excel export failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, last, run };
}

/** Zoom, baseline, linking and colour controls (shared). */
export function GanttViewControls({ zoom, setZoom, taskIds }: { zoom: GanttZoom; setZoom(z: GanttZoom): void; taskIds: string[] }) {
  const store = useStore();
  const confirm = useConfirm();
  const { settings } = store.data;
  const setBaseline = async () => {
    const r = await confirm({ title: 'Save a baseline?', message: `Records the current planned dates of the ${taskIds.length} task${taskIds.length === 1 ? '' : 's'} shown, so you can compare later changes against them. Any earlier baseline for these tasks is replaced.`, confirmLabel: 'Save baseline' });
    if (r !== 'confirm') return;
    store.setBaseline(taskIds);
    store.saveSettings({ showBaseline: true });
    store.notify('success', 'Baseline saved. Grey lines under each bar show the baseline dates.');
  };
  return (
    <>
      <div className="seg" role="group" aria-label="Zoom">
        {(['day', 'week', 'month', 'quarter'] as GanttZoom[]).map((z) => <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z[0].toUpperCase() + z.slice(1)}</button>)}
      </div>
      <label className="btn btn-sm" style={{ gap: 8 }} title="When on, moving or resizing a task moves every task linked after it">
        <input type="checkbox" checked={settings.autoSchedule} onChange={(e) => store.saveSettings({ autoSchedule: e.target.checked })} style={{ accentColor: 'var(--primary)' }} />
        Auto-schedule linked tasks
      </label>
      <div className="seg" role="group" aria-label="Colour bars by">
        <button aria-pressed={settings.ganttColorBy === 'phase'} onClick={() => store.saveSettings({ ganttColorBy: 'phase' })}>Colour: Phase</button>
        <button aria-pressed={settings.ganttColorBy === 'category'} onClick={() => store.saveSettings({ ganttColorBy: 'category' })}>Category</button>
      </div>
      <button className="btn btn-sm" aria-pressed={settings.showBaseline} onClick={() => store.saveSettings({ showBaseline: !settings.showBaseline })} title="Show or hide baseline dates">
        <IBaseline size={14} />{settings.showBaseline ? 'Hide baseline' : 'Show baseline'}
      </button>
      <button className="btn btn-sm btn-ghost" onClick={setBaseline} disabled={!taskIds.length}>Save baseline</button>
    </>
  );
}

export function GanttPage() {
  const store = useStore();
  const { data, today } = store;
  const { openNew, openTask } = useEditor();
  const [filter, setFilter] = useState<GanttFilter>({ projectId: '', status: '', from: '', to: '' });
  const [zoom, setZoomState] = useState<GanttZoom>(data.settings.ganttZoom);
  const showBaseline = data.settings.showBaseline;
  const ctl = useGanttController(filter);
  const range = useMemo(() => timelineRange(ctl.rows, zoom, today, filter.from, filter.to), [ctl.rows, zoom, today, filter.from, filter.to]);
  const selectedProject = data.projects.find((p) => p.id === filter.projectId);
  const projectStart = selectedProject?.startDate ?? (ctl.rows.length ? ctl.rows.map((r) => r.start).sort()[0] : today);
  const dw = useDisplayWeek(projectStart);
  const setZoom = (z: GanttZoom) => { setZoomState(z); store.saveSettings({ ganttZoom: z }); };
  const eligibleTotal = data.tasks.filter((t) => t.includeInGantt).length;
  const scopeLabel = filter.projectId === 'none' ? 'Tasks without a project' : filter.projectId ? data.projects.find((p) => p.id === filter.projectId)?.name ?? 'Project' : 'All projects';

  const exporter = useGanttExport();
  const busy = exporter.busy;
  const lastExport = exporter.last;
  const doExport = () => exporter.run(ctl.tasks, scopeLabel + (filter.status ? ` · ${STATUS_LABEL[filter.status as TaskStatus]}` : '') + (filter.from || filter.to ? ` · ${filter.from || '…'} to ${filter.to || '…'}` : ''), scopeLabel);

  const empty = (
    <div className="empty">
      <IGantt size={28} />
      <h3>{eligibleTotal ? 'No Gantt tasks match these filters' : 'No tasks in the Gantt chart yet'}</h3>
      <p>{eligibleTotal ? 'Clear a filter or widen the date range.' : 'Open a task and turn on “Include in Gantt Chart”. Personal items and reminders stay in the calendar only.'}</p>
      <button className="btn btn-soft" onClick={() => openNew({ startDate: today, includeInGantt: true, projectId: filter.projectId && filter.projectId !== 'none' ? filter.projectId : data.projects[0]?.id ?? null })}><IPlus size={14} />Add Gantt task</button>
    </div>
  );

  return (
    <div className="gantt-page">
      <div className="gantt-toolbar">
        <select className="select select-sm" aria-label="Project" value={filter.projectId} onChange={(e) => setFilter({ ...filter, projectId: e.target.value })}>
          <option value="">All projects</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="none">Tasks without a project</option>
        </select>
        <select className="select select-sm" aria-label="Status" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as TaskStatus | '' })}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="hstack" style={{ gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>From<input type="date" className="input input-sm" aria-label="From date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></label>
        <label className="hstack" style={{ gap: 4, fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>To<input type="date" className="input input-sm" aria-label="To date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></label>
        <GanttViewControls zoom={zoom} setZoom={setZoom} taskIds={ctl.tasks.map((t) => t.id)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => openNew({ startDate: today, includeInGantt: true, projectId: filter.projectId && filter.projectId !== 'none' ? filter.projectId : data.projects[0]?.id ?? null })}><IPlus size={14} />Add task</button>
        <button className="btn btn-primary" onClick={doExport} disabled={busy}><IDownload size={15} />{busy ? 'Building workbook…' : 'Export to Excel (.xlsx)'}</button>
      </div>
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <DisplayWeek projectStart={projectStart} ctl={dw} />
        <GanttLegend milestoneColor={data.settings.milestoneColor} rows={ctl.rows} />
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {ctl.tasks.length} of {eligibleTotal} Gantt task{eligibleTotal === 1 ? '' : 's'} shown · drag bars to reschedule, drag ends to resize{data.settings.autoSchedule ? ' · linked tasks follow automatically' : ' · auto-schedule is off: links only warn'}
          {lastExport && <> · Last export: <span className="mono">{lastExport}</span></>}
        </span>
      </div>
      <GanttChart rows={ctl.rows} range={range} zoom={zoom} today={today} colorOf={ctl.colorOf} rowColor={ctl.rowColor} scrollTo={dw.scrollTo} milestoneColor={data.settings.milestoneColor}
        showBaseline={showBaseline} collapsed={ctl.collapsed} onToggle={ctl.toggle} onOpen={openTask} onReschedule={ctl.reschedule} emptyState={empty} />
    </div>
  );
}
