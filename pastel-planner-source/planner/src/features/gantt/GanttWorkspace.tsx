import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ICalendar, ICheck, IChevL, ICopy, IDownload, IEdit, IGantt, ILink, IMenu, IPlus, ISearch, ITrash, IX } from '../../components/Icons';
import { useEditor } from '../../components/TaskEditor';
import { CategoryChip, Popover, useConfirm, useEscape } from '../../components/ui';
import { useStore } from '../../data/store';
import { PHASE_PALETTE } from '../../domain/defaults';
import { addDays, diffDays, fmtDate, toEpochDay } from '../../domain/dates';
import { timelineRange } from '../../domain/gantt';
import { newTask, nowISO, projectProgress, uid } from '../../domain/tasks';
import type { GanttZoom, Project, Task } from '../../domain/types';
import { PROJECT_STATUS_LABEL } from '../../domain/types';
import { PhaseEditor, ProjectDialog } from '../projects/ProjectParts';
import { GanttChart } from './GanttChart';
import { DisplayWeek, GanttLegend, GanttPage, GanttViewControls, useDisplayWeek, useGanttController, useGanttExport } from './GanttPage';

/**
 * Gantt Charts workspace — a conversation-style layout: every project is
 * one independent chart listed in the left rail (newest activity first),
 * "+ New Gantt Chart" creates one instantly, and the main area shows the
 * selected chart with a task composer at the bottom.
 */

export const ALL = '__all__';

/** Stable pastel colour for a project's dot in the rail. */
export function projectDot(p: Project) {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PHASE_PALETTE[h % PHASE_PALETTE.length];
}

function lastActivity(p: Project, tasks: Task[]) {
  return tasks.reduce((m, t) => (t.projectId === p.id && t.updatedAt > m ? t.updatedAt : m), p.updatedAt);
}

export function GanttWorkspace({ focus, setFocus }: { focus: string | null; setFocus(id: string | null): void }) {
  const store = useStore();
  const { data } = store;
  const [railOpen, setRailOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState<boolean>(() => { try { return localStorage.getItem('pp:ui:railCollapsed') === '1'; } catch { return false; } });
  const setCollapsed = (v: boolean) => { setCollapsedState(v); try { localStorage.setItem('pp:ui:railCollapsed', v ? '1' : '0'); } catch { /* ignore */ } };
  const [renaming, setRenaming] = useState<string | null>(null);
  const [details, setDetails] = useState<Project | null>(null);
  const current = focus === ALL ? null : data.projects.find((p) => p.id === focus) ?? null;
  const showAll = focus === ALL || (!current && data.projects.length === 0 ? false : !current);

  // Default selection: the most recently active chart.
  useEffect(() => {
    if (focus === ALL || current) return;
    const latest = [...data.projects].sort((a, b) => lastActivity(b, data.tasks).localeCompare(lastActivity(a, data.tasks)))[0];
    if (latest) setFocus(latest.id);
  }, [focus, current, data.projects, data.tasks, setFocus]);

  const createChart = () => {
    const base = 'Untitled Gantt chart';
    let name = base;
    for (let i = 2; data.projects.some((p) => p.name === name); i++) name = `${base} ${i}`;
    const ts = nowISO();
    const p: Project = {
      id: uid('p'), name, description: '', startDate: store.today, targetEndDate: addDays(store.today, 30), status: 'active',
      priority: 'medium', owner: '', progressMode: 'auto', manualProgress: 0, createdAt: ts, updatedAt: ts,
    };
    store.saveProject(p);
    setFocus(p.id);
    setRenaming(`title:${p.id}`);
    setRailOpen(false);
  };

  return (
    <div className={`gw ${collapsed ? 'collapsed' : ''}`}>
      {railOpen && <div className="gw-scrim" onClick={() => setRailOpen(false)} />}
      <ChartRail open={railOpen} focus={focus} onSelect={(id) => { setFocus(id); setRailOpen(false); }} onCreate={createChart}
        renaming={renaming} setRenaming={setRenaming} onDetails={setDetails} onCollapse={() => setCollapsed(true)} />
      <section className="gw-main" aria-label="Gantt chart">
        <button className="btn btn-sm gw-rail-toggle" onClick={() => setRailOpen(true)}><IMenu size={14} />All charts</button>
        {collapsed && <button className="btn btn-sm gw-rail-expand" onClick={() => setCollapsed(false)} title="Show the chart list"><IMenu size={14} />Charts</button>}
        {current ? (
          <ChartWorkspace key={current.id} project={current} renamingTitle={renaming === `title:${current.id}`} setRenaming={setRenaming} onDetails={() => setDetails(current)} />
        ) : showAll && data.projects.length ? (
          <div className="gw-overview">
            <div className="gw-head"><div><h2 className="gw-title-static">All projects overview</h2><p className="muted gw-sub">Every task marked “Include in Gantt Chart”, across all charts. Filter it, compare projects, or export everything at once.</p></div></div>
            <GanttPage />
          </div>
        ) : (
          <div className="gw-welcome">
            <span className="gw-welcome-mark" aria-hidden="true"><IGantt size={28} /></span>
            <h2>Plan a project as a Gantt chart</h2>
            <p>Each chart is one project with its own tasks, phases, milestones and progress. Start one, give it a name, and type your tasks below the timeline.</p>
            <button className="btn btn-primary" onClick={createChart}><IPlus size={15} />New Gantt Chart</button>
          </div>
        )}
      </section>
      {details && <ProjectDialog project={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

/* ---------------- Left rail ---------------- */

function ChartRail({ open, focus, onSelect, onCreate, renaming, setRenaming, onDetails, onCollapse }: {
  open: boolean; focus: string | null; onSelect(id: string): void; onCreate(): void;
  renaming: string | null; setRenaming(v: string | null): void; onDetails(p: Project): void; onCollapse(): void;
}) {
  const store = useStore();
  const { data, today } = store;
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ p: Project; rect: DOMRect } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const confirm = useConfirm();

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = data.projects
      .filter((p) => !ql || p.name.toLowerCase().includes(ql))
      .map((p) => ({ p, at: lastActivity(p, data.tasks) }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const active = list.filter((x) => x.p.status !== 'completed' && x.p.status !== 'cancelled');
    const done = list.filter((x) => x.p.status === 'completed' || x.p.status === 'cancelled');
    const age = (iso: string) => diffDays(iso.slice(0, 10), today);
    const out: { label: string; items: Project[] }[] = [
      { label: 'Today', items: active.filter((x) => age(x.at) <= 0).map((x) => x.p) },
      { label: 'Previous 7 days', items: active.filter((x) => age(x.at) > 0 && age(x.at) <= 7).map((x) => x.p) },
      { label: 'Previous 30 days', items: active.filter((x) => age(x.at) > 7 && age(x.at) <= 30).map((x) => x.p) },
      { label: 'Older', items: active.filter((x) => age(x.at) > 30).map((x) => x.p) },
    ];
    return { out: out.filter((g) => g.items.length), done: done.map((x) => x.p) };
  }, [data.projects, data.tasks, q, today]);

  const remove = async (p: Project) => {
    const n = data.tasks.filter((t) => t.projectId === p.id).length;
    const r = await confirm({
      title: `Delete “${p.name}”?`,
      message: n ? `This chart has ${n} task${n > 1 ? 's' : ''}. Keep them in your calendar as standalone tasks, or delete them with the chart?` : 'The chart and its phases are removed.',
      confirmLabel: n ? 'Delete chart and tasks' : 'Delete chart', altLabel: n ? 'Delete chart, keep tasks' : undefined, danger: true,
    });
    if (r === 'cancel') return;
    store.deleteProject(p.id, r === 'confirm' ? 'delete_tasks' : 'keep_tasks');
    store.notify('info', `Deleted “${p.name}”${n && r === 'alt' ? '. Its tasks stay in your calendar.' : ''}`);
    if (focus === p.id) onSelect('');
  };

  const duplicate = (p: Project) => {
    const ts = nowISO();
    const np: Project = { ...p, id: uid('p'), name: `${p.name} (copy)`, createdAt: ts, updatedAt: ts, isExample: false };
    store.saveProject(np);
    const phaseMap = new Map<string, string>();
    data.phases.filter((ph) => ph.projectId === p.id).forEach((ph) => { const id = uid('ph'); phaseMap.set(ph.id, id); store.savePhase({ ...ph, id, projectId: np.id }); });
    const own = data.tasks.filter((t) => t.projectId === p.id);
    const idMap = new Map(own.map((t) => [t.id, uid('t')]));
    own.forEach((t) => store.saveTask({
      ...t, id: idMap.get(t.id)!, projectId: np.id, phaseId: t.phaseId ? phaseMap.get(t.phaseId) ?? null : null,
      parentTaskId: t.parentTaskId ? idMap.get(t.parentTaskId) ?? null : null,
      dependencyIds: t.dependencyIds.map((d) => idMap.get(d)).filter(Boolean) as string[],
      status: 'not_started', progress: 0, completedAt: null, actualStart: null, actualEnd: null, createdAt: ts, isExample: false,
    }, { quiet: true }));
    store.notify('success', `Duplicated as “${np.name}” with ${own.length} task${own.length === 1 ? '' : 's'} (progress reset).`);
    onSelect(np.id);
  };

  const Item = ({ p }: { p: Project }) => {
    const prog = projectProgress(p, data.tasks);
    const isRenaming = renaming === `rail:${p.id}`;
    return (
      <div className={`gw-item ${focus === p.id ? 'active' : ''}`}>
        {isRenaming ? (
          <RenameInput initial={p.name} label="Chart name" onDone={(v) => { if (v && v !== p.name) store.saveProject({ ...p, name: v }); setRenaming(null); }} />
        ) : (
          <button className="gw-item-main" aria-current={focus === p.id ? 'page' : undefined} onClick={() => onSelect(p.id)} onDoubleClick={() => setRenaming(`rail:${p.id}`)} title={`${p.name} · ${prog}% complete`}>
            <span className="gw-dot" style={{ background: projectDot(p) }} />
            <span className="gw-name">{p.name}</span>
            <span className="gw-pct mono">{prog}%</span>
          </button>
        )}
        {!isRenaming && (
          <button className="gw-more" aria-label={`Options for ${p.name}`} onClick={(e) => setMenu({ p, rect: e.currentTarget.getBoundingClientRect() })}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className={`gw-rail ${open ? 'open' : ''}`} aria-label="Gantt charts">
      <div className="gw-rail-top">
        <button className="btn btn-primary gw-new" onClick={onCreate}><IPlus size={15} />New Gantt Chart</button>
        <button className="icon-btn gw-collapse" aria-label="Hide chart list" title="Hide chart list" onClick={onCollapse}><IChevL size={16} /></button>
      </div>
      <div className="search gw-search">
        <ISearch size={14} />
        <input className="input" placeholder="Search charts" aria-label="Search charts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <nav className="gw-list">
        {data.projects.length > 0 && (
          <button className={`gw-item-main gw-all ${focus === ALL ? 'active' : ''}`} aria-current={focus === ALL ? 'page' : undefined} onClick={() => onSelect(ALL)}>
            <IGantt size={14} /><span className="gw-name">All projects overview</span>
          </button>
        )}
        {groups.out.map((g) => (
          <div key={g.label} className="gw-group">
            <div className="gw-group-label">{g.label}</div>
            {g.items.map((p) => <Item key={p.id} p={p} />)}
          </div>
        ))}
        {groups.done.length > 0 && (
          <div className="gw-group">
            <button className="gw-group-label gw-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>Completed & archived ({groups.done.length}) {showDone ? '▾' : '▸'}</button>
            {showDone && groups.done.map((p) => <Item key={p.id} p={p} />)}
          </div>
        )}
        {data.projects.length === 0 && <p className="gw-empty-rail">Your charts will appear here.</p>}
        {data.projects.length > 0 && q && !groups.out.length && !groups.done.length && <p className="gw-empty-rail">No charts match “{q}”.</p>}
      </nav>
      {menu && (
        <Popover anchor={menu.rect} onClose={() => setMenu(null)} className="gw-menu" label={`Options for ${menu.p.name}`}>
          <button onClick={() => { setRenaming(`rail:${menu.p.id}`); setMenu(null); }}><IEdit size={14} />Rename</button>
          <button onClick={() => { onDetails(menu.p); setMenu(null); }}><ICalendar size={14} />Project details</button>
          <button onClick={() => { duplicate(menu.p); setMenu(null); }}><ICopy size={14} />Duplicate</button>
          {menu.p.status === 'completed' || menu.p.status === 'cancelled'
            ? <button onClick={() => { store.saveProject({ ...menu.p, status: 'active' }); setMenu(null); }}><IGantt size={14} />Reopen</button>
            : <button onClick={() => { store.saveProject({ ...menu.p, status: 'completed' }); store.notify('success', `“${menu.p.name}” marked complete and moved to Completed.`); setMenu(null); }}><ICheck size={14} />Mark as completed</button>}
          <hr />
          <button className="danger" onClick={() => { const p = menu.p; setMenu(null); void remove(p); }}><ITrash size={14} />Delete</button>
        </Popover>
      )}
    </aside>
  );
}

function RenameInput({ initial, onDone, label, className = 'input input-sm gw-rename' }: { initial: string; onDone(v: string | null): void; label: string; className?: string }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val === null ? null : val.trim() || null); };
  return (
    <input ref={ref} className={className} aria-label={label} value={v} maxLength={120}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(v); } if (e.key === 'Escape') { e.stopPropagation(); finish(null); } }}
      onBlur={() => finish(v)} />
  );
}

/* ---------------- One chart ---------------- */

function ChartWorkspace({ project: p, renamingTitle, setRenaming, onDetails }: { project: Project; renamingTitle: boolean; setRenaming(v: string | null): void; onDetails(): void }) {
  const store = useStore();
  const { data, today } = store;
  const { openTask, openNew } = useEditor();
  const [zoom, setZoomState] = useState<GanttZoom>(data.settings.ganttZoom);
  const [panel, setPanel] = useState<'phases' | 'link' | null>(null);
  const filter = useMemo(() => ({ projectId: p.id }), [p.id]);
  const ctl = useGanttController(filter);
  const range = useMemo(() => timelineRange(ctl.rows, zoom, today), [ctl.rows, zoom, today]);
  const dw = useDisplayWeek(p.startDate);
  const exporter = useGanttExport();
  const composerRef = useRef<HTMLInputElement>(null);
  const setZoom = (z: GanttZoom) => { setZoomState(z); store.saveSettings({ ganttZoom: z }); };
  const composerFocus = () => setTimeout(() => composerRef.current?.focus(), 0);

  const own = data.tasks.filter((t) => t.projectId === p.id);
  const hidden = own.filter((t) => !t.includeInGantt);
  const prog = projectProgress(p, data.tasks);
  const span = ctl.rows.length ? [ctl.rows[0].start, ctl.rows[0].end] as const : null;
  const milestones = own.filter((t) => t.isMilestone).length;
  const late = span && toEpochDay(span[1]) > toEpochDay(p.targetEndDate);

  const empty = (
    <div className="empty">
      <IGantt size={28} />
      <h3>{hidden.length ? 'Tasks are hidden from this chart' : 'Start your plan'}</h3>
      <p>{hidden.length ? `${hidden.length} task${hidden.length > 1 ? 's in this project are' : ' in this project is'} not shown in the chart.` : 'Type your first task in the box below the chart, or bring in tasks you already have in your calendar.'}</p>
      <div className="hstack" style={{ justifyContent: 'center' }}>
        {hidden.length > 0 && <button className="btn btn-soft" onClick={() => { hidden.forEach((t) => store.saveTask({ ...t, includeInGantt: true }, { quiet: true })); }}>Show {hidden.length} task{hidden.length > 1 ? 's' : ''}</button>}
        <button className="btn btn-soft" onClick={() => composerRef.current?.focus()}><IPlus size={14} />Add a task</button>
        <button className="btn" onClick={() => setPanel('link')}><ILink size={14} />Link calendar tasks</button>
      </div>
    </div>
  );

  return (
    <div className="gw-chart">
      <header className="gw-head">
        <div className="gw-head-main">
          <span className="gw-dot lg" style={{ background: projectDot(p) }} aria-hidden="true" />
          {renamingTitle ? (
            <RenameInput initial={p.name} label="Gantt chart name" className="input gw-title-input"
              onDone={(v) => { if (v && v !== p.name) { store.saveProject({ ...p, name: v }); if (!p.name.startsWith('Untitled Gantt chart')) store.notify('success', `Renamed to “${v}”`); } setRenaming(null); composerFocus(); }} />
          ) : (
            <button className="gw-title" onClick={() => setRenaming(`title:${p.id}`)} title="Click to rename">{p.name}<IEdit size={14} /></button>
          )}
          <span className="badge">{PROJECT_STATUS_LABEL[p.status]}</span>
          {p.isExample && <span className="badge example">Example</span>}
        </div>
        <div className="gw-actions">
          <button className="btn btn-sm" onClick={() => setPanel('link')}><ILink size={14} />Link calendar tasks</button>
          <button className="btn btn-sm" onClick={() => setPanel('phases')}>Phases ({data.phases.filter((ph) => ph.projectId === p.id).length})</button>
          <button className="btn btn-sm btn-ghost" onClick={onDetails}>Details</button>
          <button className="btn btn-primary btn-sm" onClick={() => exporter.run(ctl.tasks, p.name)} disabled={exporter.busy}><IDownload size={14} />{exporter.busy ? 'Building…' : 'Export to Excel (.xlsx)'}</button>
        </div>
        <div className="gw-meta">
          <span className="progress gw-prog" role="progressbar" aria-valuenow={prog} aria-valuemin={0} aria-valuemax={100} aria-label="Project progress"><i style={{ width: `${prog}%`, background: 'var(--primary)' }} /></span>
          <span className="mono">{prog}% complete</span>
          <span>·</span>
          <span>{span ? <>{fmtDate(span[0], { year: false })} – {fmtDate(span[1])} · {diffDays(span[0], span[1]) + 1} days</> : 'No dates yet'}</span>
          <span>·</span>
          <span>{ctl.tasks.length} task{ctl.tasks.length === 1 ? '' : 's'} · {milestones} milestone{milestones === 1 ? '' : 's'}</span>
          <span>·</span>
          <span className={late ? 'gw-late' : ''}>Target {fmtDate(p.targetEndDate)}{late ? ` (plan ends ${diffDays(p.targetEndDate, span![1])}d later)` : ''}</span>
          {exporter.last && <><span>·</span><span>Last export <span className="mono">{exporter.last}</span></span></>}
        </div>
      </header>

      <div className="gantt-toolbar gw-toolbar">
        <DisplayWeek projectStart={p.startDate} ctl={dw} />
        <GanttViewControls zoom={zoom} setZoom={setZoom} taskIds={ctl.tasks.map((t) => t.id)} />
      </div>
      <GanttLegend milestoneColor={data.settings.milestoneColor} rows={ctl.rows} />

      <div className="gw-canvas">
        <GanttChart rows={ctl.rows} range={range} zoom={zoom} today={today} colorOf={ctl.colorOf} rowColor={ctl.rowColor} scrollTo={dw.scrollTo}
          milestoneColor={data.settings.milestoneColor} showBaseline={data.settings.showBaseline} collapsed={ctl.collapsed} onToggle={ctl.toggle}
          onOpen={openTask} onReschedule={ctl.reschedule} emptyState={empty} />
      </div>

      {hidden.length > 0 && ctl.tasks.length > 0 && (
        <div className="alert info gw-hidden">
          <span style={{ flex: 1 }}>{hidden.length} task{hidden.length > 1 ? 's' : ''} in this project {hidden.length > 1 ? 'are' : 'is'} kept in the calendar only.</span>
          <button className="btn btn-sm" onClick={() => hidden.forEach((t) => store.saveTask({ ...t, includeInGantt: true }, { quiet: true }))}>Show in chart</button>
        </div>
      )}

      <Composer project={p} inputRef={composerRef} onMore={(draft) => openNew(draft)} />

      {panel === 'phases' && (
        <SidePanel title="Phases" onClose={() => setPanel(null)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>Phases group the chart into stages. Each has its own colour; their dates stretch automatically to fit their tasks.</p>
          <PhaseEditor projectId={p.id} phases={data.phases.filter((ph) => ph.projectId === p.id).sort((a, b) => a.order - b.order)} project={p} />
        </SidePanel>
      )}
      {panel === 'link' && <LinkTasksPanel project={p} onClose={() => setPanel(null)} />}
    </div>
  );
}

/* ---------------- Composer (type a task, press Enter) ---------------- */

function Composer({ project: p, inputRef, onMore }: { project: Project; inputRef: React.RefObject<HTMLInputElement>; onMore(d: Partial<Task> & { startDate: string }): void }) {
  const store = useStore();
  const { data, today } = store;
  const phases = data.phases.filter((ph) => ph.projectId === p.id).sort((a, b) => a.order - b.order);
  const own = data.tasks.filter((t) => t.projectId === p.id);
  const lastEnd = own.length ? own.map((t) => t.endDate).sort().pop()! : null;
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(lastEnd ? addDays(lastEnd, 1) : p.startDate || today);
  const [days, setDays] = useState(3);
  const [phaseId, setPhaseId] = useState<string>(phases[phases.length - 1]?.id ?? '');
  const [after, setAfter] = useState(true);
  const [milestone, setMilestone] = useState(false);
  const latest = own.filter((t) => !t.parentTaskId).sort((a, b) => b.endDate.localeCompare(a.endDate) || b.createdAt.localeCompare(a.createdAt))[0];

  useEffect(() => { if (lastEnd && after) setStart(addDays(lastEnd, 1)); }, [lastEnd, after]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) { inputRef.current?.focus(); return; }
    const d = Math.max(1, Math.round(days) || 1);
    const t = newTask({
      title: name, categoryId: 'work', startDate: start, endDate: milestone ? start : addDays(start, d - 1),
      projectId: p.id, phaseId: phaseId || null, includeInGantt: true, isMilestone: milestone,
      dependencyIds: after && latest ? [latest.id] : [],
    });
    const saved = store.saveTask(t, { relinked: true });
    store.notify('success', `Added “${saved.title}”${after && latest ? ` after “${latest.title}”` : ''}`, { label: 'Edit', run: () => onMore(saved) });
    setTitle('');
    setMilestone(false);
    inputRef.current?.focus();
  };

  return (
    <form className="gw-composer" onSubmit={submit} aria-label={`Add a task to ${p.name}`}>
      <div className="gw-composer-box">
        <input ref={inputRef} className="gw-composer-input" placeholder={milestone ? 'Name a milestone, e.g. “Go-live”…' : `Add a task to “${p.name}”… e.g. “Install core switches”`} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task name" />
        <button type="submit" className="gw-send" aria-label="Add task" disabled={!title.trim()}><IPlus size={16} /></button>
      </div>
      <div className="gw-composer-opts">
        <label>Start <input type="date" className="input input-sm" value={start} onChange={(e) => { setStart(e.target.value); setAfter(false); }} aria-label="Start date" /></label>
        {!milestone && <label>Days <input type="number" min={1} className="input input-sm mono" style={{ width: 64 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Duration in days" /></label>}
        {phases.length > 0 && (
          <label>Phase
            <select className="select select-sm" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} aria-label="Phase">
              <option value="">No phase</option>
              {phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
            </select>
          </label>
        )}
        {latest && <label className="gw-check"><input type="checkbox" checked={after} onChange={(e) => setAfter(e.target.checked)} />Starts after “{latest.title}”</label>}
        <label className="gw-check"><input type="checkbox" checked={milestone} onChange={(e) => setMilestone(e.target.checked)} />Milestone</label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onMore({ startDate: start, endDate: addDays(start, Math.max(1, days) - 1), title: title.trim(), projectId: p.id, phaseId: phaseId || null, includeInGantt: true, categoryId: 'work' })}>More options…</button>
      </div>
    </form>
  );
}

/* ---------------- Panels ---------------- */

function SidePanel({ title, onClose, children, footer }: { title: string; onClose(): void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h2>{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><IX /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Pick existing calendar tasks and link them to this chart. */
function LinkTasksPanel({ project: p, onClose }: { project: Project; onClose(): void }) {
  const store = useStore();
  const { data } = store;
  const [q, setQ] = useState('');
  const [others, setOthers] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const candidates = data.tasks
    .filter((t) => t.projectId !== p.id && (others || !t.projectId) && !t.parentTaskId)
    .filter((t) => !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const cat = (id: string) => data.categories.find((c) => c.id === id) ?? data.categories[0];
  const link = () => {
    const chosen = data.tasks.filter((t) => sel.has(t.id));
    for (const t of chosen) {
      store.saveTask({ ...t, projectId: p.id, phaseId: null, includeInGantt: true, dependencyIds: t.dependencyIds.filter((d) => sel.has(d) || data.tasks.find((x) => x.id === d)?.projectId === p.id) }, { quiet: true });
    }
    store.notify('success', `Linked ${chosen.length} task${chosen.length > 1 ? 's' : ''} to “${p.name}”. They stay in your calendar too.`);
    onClose();
  };
  return (
    <SidePanel title={`Link calendar tasks to “${p.name}”`} onClose={onClose}
      footer={<><span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{sel.size} selected</span><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!sel.size} onClick={link}>Link {sel.size || ''} task{sel.size === 1 ? '' : 's'}</button></>}>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>Linked tasks keep their dates and stay on the calendar. They join this chart and its Excel export.</p>
      <div className="search" style={{ width: '100%' }}><ISearch size={14} /><input className="input" placeholder="Search your tasks" aria-label="Search your tasks" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <label className="gw-check"><input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />Also show tasks that belong to other charts (they move to this one)</label>
      <div className="link-list">
        {candidates.length === 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>No tasks to link. Add tasks on the calendar first, or tick the option above.</p>}
        {candidates.map((t) => (
          <label key={t.id} className={`link-row ${sel.has(t.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(t.id) : n.delete(t.id); return n; })} />
            <span className="link-main">
              <strong>{t.title}</strong>
              <span className="task-meta"><CategoryChip cat={cat(t.categoryId)} /><span className="mono">{t.startDate === t.endDate ? fmtDate(t.startDate) : `${fmtDate(t.startDate, { year: false })} → ${fmtDate(t.endDate)}`}</span>
                {t.projectId && <span>· in {data.projects.find((x) => x.id === t.projectId)?.name}</span>}</span>
            </span>
          </label>
        ))}
      </div>
    </SidePanel>
  );
}
