import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CatIcon, IBell, ICalendar, IChevL, IChevR, IFolder, IGantt, IHome, IList, IMenu, IPlus, ISearch, ISettings,
} from './components/Icons';
import { EditorProvider, useEditor } from './components/TaskEditor';
import { catVars, ConfirmProvider, Toasts } from './components/ui';
import { StoreProvider, useStore } from './data/store';
import { addMonths, fmtDate, monthGrid, MONTHS, parts, WEEKDAYS_SHORT } from './domain/dates';
import { isOverdue, occursOn } from './domain/tasks';
import type { CalendarView, ISODate } from './domain/types';
import { CalendarPage } from './features/calendar/CalendarPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ALL, GanttWorkspace } from './features/gantt/GanttWorkspace';
import { SettingsPage } from './features/settings/SettingsPage';
import { TasksPage } from './features/tasks/TasksPage';

export type Route = 'calendar' | 'gantt' | 'tasks' | 'dashboard' | 'prefs';
const ROUTES: { id: Route; label: string; icon: (p: any) => JSX.Element }[] = [
  { id: 'calendar', label: 'Calendar', icon: ICalendar },
  { id: 'gantt', label: 'Gantt Charts', icon: IGantt },
  { id: 'tasks', label: 'My Tasks', icon: IList },
  { id: 'dashboard', label: 'Dashboard', icon: IHome },
  { id: 'prefs', label: 'Settings', icon: ISettings },
];

const readHash = (): Route => {
  const h = location.hash.replace('#', '').replace(/^projects$/, 'gantt');
  return (ROUTES.some((r) => r.id === h) ? h : 'calendar') as Route;
};

/** Per-viewer UI conveniences (filters, view). Never required for correctness. */
const prefs = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(`pp:ui:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(`pp:ui:${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};

export default function App() {
  return (
    <StoreProvider>
      <ConfirmProvider>
        <EditorProvider>
          <Shell />
          <Toasts />
        </EditorProvider>
      </ConfirmProvider>
    </StoreProvider>
  );
}

function Shell() {
  const store = useStore();
  const { data, today, status } = store;
  const { openNew } = useEditor();
  const [route, setRoute] = useState<Route>(readHash);
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<ISODate>(today);
  const [view, setView] = useState<CalendarView>(() => prefs.get('view', 'month'));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(prefs.get<string[]>('hiddenCats', [])));
  const [projectFocus, setProjectFocus] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { prefs.set('view', view); }, [view]);
  useEffect(() => { prefs.set('hiddenCats', [...hidden]); }, [hidden]);

  const go = useCallback((r: Route) => {
    setRoute(r);
    setNavOpen(false);
    try { history.replaceState(null, '', `#${r}`); } catch { /* sandboxed */ }
  }, []);
  const openProject = useCallback((id: string) => { setProjectFocus(id); go('gantt'); }, [go]);

  const toggleCategory = (id: string) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const overdue = data.tasks.filter((t) => isOverdue(t, today)).length;
  const dueToday = data.tasks.filter((t) => occursOn(t, today) && t.status !== 'completed' && t.status !== 'cancelled').length;

  const addTask = () => {
    const chartId = projectFocus && projectFocus !== ALL ? projectFocus : null;
    const defaults = route === 'gantt' && chartId
      ? { startDate: today, includeInGantt: true, projectId: chartId }
      : { startDate: route === 'calendar' ? selected : today };
    openNew(defaults);
  };

  if (status === 'loading') return <div className="loading">Loading your planner…</div>;
  if (status === 'error') return <div className="loading"><div className="empty"><h3>Your planner could not be loaded</h3><p>{store.error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div></div>;

  const routeLabel = ROUTES.find((r) => r.id === route)!.label;

  return (
    <div className="app">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i style={{ background: 'var(--lavender)' }} /><i style={{ background: 'var(--blue)' }} /><i style={{ background: 'var(--pink)' }} /><i style={{ background: 'var(--sage)' }} />
          </span>
          <span><div className="brand-name">Pastel Planner</div><div className="brand-sub">Schedule · Tasks · Projects</div></span>
        </div>
        <button className="btn btn-primary" onClick={addTask} style={{ height: 38 }}><IPlus size={15} />Add task</button>
        <nav className="nav">
          {ROUTES.map((r) => (
            <button key={r.id} className="nav-item" aria-current={route === r.id ? 'page' : undefined} onClick={() => go(r.id)}>
              <r.icon size={17} />{r.label}
              {r.id === 'tasks' && overdue > 0 && <span className="count alert" title={`${overdue} overdue`}>{overdue}</span>}
              {r.id === 'dashboard' && dueToday > 0 && <span className="count" title={`${dueToday} today`}>{dueToday}</span>}
            </button>
          ))}
        </nav>
        <MiniCalendar selected={selected} onPick={(d) => { setSelected(d); go('calendar'); }} />
        <div>
          <div className="side-section-title">Categories</div>
          <div className="legend-list">
            {data.categories.filter((c) => c.isActive).map((c) => (
              <button key={c.id} className="legend-item" aria-pressed={!hidden.has(c.id)} onClick={() => toggleCategory(c.id)} title={hidden.has(c.id) ? `Show ${c.name} in the calendar` : `Hide ${c.name} in the calendar`}>
                <span className="swatch" style={{ ...catVars(c.color), background: c.color, color: 'var(--chip-ink)' }}><CatIcon icon={c.icon} size={10} /></span>
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="storage-note"><span className="dot" style={{ background: store.demo ? 'var(--butter-ink)' : store.storageKind === 'memory' ? 'var(--danger)' : 'var(--sage-ink)', marginTop: 5 }} />{store.demo ? 'Example planner: changes are not saved' : `Saved to: ${store.storageLabel}`}</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)}><IMenu /></button>
          <h1>{routeLabel}</h1>
          <span className="spacer" />
          <GlobalSearch onProject={openProject} />
          <button className="btn btn-primary" onClick={addTask}><IPlus size={15} />Add task</button>
        </header>
        <ReminderBanner />
        {store.demo && <ExampleBanner />}
        {route === 'calendar' && !store.demo && !data.settings.onboarded && data.tasks.length === 0 && <Welcome go={go} />}
        <main className={`content ${route === 'calendar' || route === 'gantt' ? 'flush' : ''}`}>
          {route === 'calendar' && <CalendarPage hidden={hidden} toggleCategory={toggleCategory} selected={selected} setSelected={setSelected} view={view} setView={setView} />}
          {route === 'tasks' && <TasksPage />}
          {route === 'dashboard' && <DashboardPage go={go} openProject={openProject} />}
          {route === 'gantt' && <GanttWorkspace focus={projectFocus} setFocus={setProjectFocus} />}
          {route === 'prefs' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

function Welcome({ go }: { go(r: Route): void }) {
  const store = useStore();
  return (
    <div className="welcome" role="region" aria-label="Getting started">
      <div className="txt">
        <strong>Welcome to your planner</strong>
        <span>Your planner is empty and ready. Click any date to add a task, or drag across several dates for a multi-day task. Want to see a filled-in example first? It opens as a separate practice copy, and you can come back anytime.</span>
      </div>
      <button className="btn btn-primary" onClick={() => store.saveSettings({ onboarded: true })}>Start planning</button>
      <button className="btn btn-ghost" onClick={() => { store.enterExample(); go('calendar'); }}>See an example</button>
    </div>
  );
}

/** Always-visible way back from the example planner. */
function ExampleBanner() {
  const store = useStore();
  return (
    <div className="example-banner" role="status">
      <span className="eb-text"><strong>You're viewing the example planner.</strong> Try anything you like. Nothing here is saved, and your own planner isn't changed.</span>
      <button className="btn btn-primary btn-sm" onClick={() => store.exitExample()}><IChevL size={14} />Back to my planner</button>
    </div>
  );
}

function MiniCalendar({ selected, onPick }: { selected: ISODate; onPick(d: ISODate): void }) {
  const { data, today } = useStore();
  const [cursor, setCursor] = useState(() => { const p = parts(selected); return { year: p.year, month: p.month }; });
  useEffect(() => { const p = parts(selected); setCursor({ year: p.year, month: p.month }); }, [selected]);
  const ws = data.settings.weekStartsOn;
  const weeks = monthGrid(cursor.year, cursor.month, ws);
  const busy = useMemo(() => {
    const s = new Set<string>();
    for (const w of weeks) for (const d of w) if (data.tasks.some((t) => occursOn(t, d))) s.add(d);
    return s;
  }, [weeks, data.tasks]);
  return (
    <div className="mini" aria-label="Month overview">
      <div className="mini-head">
        <strong>{MONTHS[cursor.month]} {cursor.year}</strong>
        <span>
          <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Previous month" onClick={() => setCursor(addMonths(cursor.year, cursor.month, -1))}><IChevL size={14} /></button>
          <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Next month" onClick={() => setCursor(addMonths(cursor.year, cursor.month, 1))}><IChevR size={14} /></button>
        </span>
      </div>
      <div className="mini-grid">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="dow">{WEEKDAYS_SHORT[(i + ws) % 7].slice(0, 2)}</div>)}
        {weeks.flat().map((d) => {
          const p = parts(d);
          const cls = ['mini-day', p.month !== cursor.month && 'out', d === selected && 'sel', d === today && 'today', busy.has(d) && 'has'].filter(Boolean).join(' ');
          return <button key={d} className={cls} onClick={() => onPick(d)} aria-label={fmtDate(d, { weekday: true })}>{p.day}</button>;
        })}
      </div>
      <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() => onPick(today)}>Jump to today</button>
    </div>
  );
}

function GlobalSearch({ onProject }: { onProject(id: string): void }) {
  const { data } = useStore();
  const { openTask } = useEditor();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  const ql = q.trim().toLowerCase();
  const tasks = ql ? data.tasks.filter((t) => t.title.toLowerCase().includes(ql) || t.description.toLowerCase().includes(ql)).slice(0, 8) : [];
  const projects = ql ? data.projects.filter((p) => p.name.toLowerCase().includes(ql)).slice(0, 4) : [];
  const cat = (id: string) => data.categories.find((c) => c.id === id) ?? data.categories[0];
  return (
    <div className="search" ref={ref}>
      <ISearch size={15} />
      <input className="input" placeholder="Search tasks & projects" aria-label="Search tasks and projects" value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); } }} />
      {open && ql && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {!tasks.length && !projects.length && <div className="muted" style={{ padding: 10, fontSize: 'var(--fs-sm)' }}>Nothing matches “{q}”.</div>}
          {projects.map((p) => (
            <button key={p.id} className="search-result" onClick={() => { setOpen(false); setQ(''); onProject(p.id); }}>
              <IFolder size={15} /><span style={{ flex: 1 }}><strong>{p.name}</strong><div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Project · {fmtDate(p.startDate)} – {fmtDate(p.targetEndDate)}</div></span>
            </button>
          ))}
          {tasks.map((t) => (
            <button key={t.id} className="search-result" onClick={() => { setOpen(false); setQ(''); openTask(t.id); }}>
              <span className="dot" style={{ background: cat(t.categoryId).color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', width: 10, height: 10 }} />
              <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</strong>
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{cat(t.categoryId).name} · {fmtDate(t.startDate)}{t.endDate !== t.startDate ? ` – ${fmtDate(t.endDate)}` : ''}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** In-app reminders: only fire while the planner is open. */
function ReminderBanner() {
  const store = useStore();
  const { openTask } = useEditor();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const due = store.data.tasks.filter((t) => t.reminderAt && !t.reminderDismissed && t.status !== 'completed' && new Date(t.reminderAt).getTime() <= now);
  if (!due.length) return null;
  const t = due[0];
  return (
    <div className="reminder-banner" role="status">
      <IBell size={15} />
      <span style={{ flex: 1 }}>Reminder: {t.title} · {fmtDate(t.startDate)}{due.length > 1 ? ` (+${due.length - 1} more)` : ''}</span>
      <button className="btn btn-sm" onClick={() => openTask(t.id)}>Open</button>
      <button className="btn btn-sm" onClick={() => store.saveTask({ ...t, reminderDismissed: true })}>Dismiss</button>
    </div>
  );
}

