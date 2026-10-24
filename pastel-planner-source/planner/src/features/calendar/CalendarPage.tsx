import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CatIcon, IAlert, ICheck, IChevD, IChevL, IChevR, IPlus } from '../../components/Icons';
import { useEditor } from '../../components/TaskEditor';
import { catVars, Popover } from '../../components/ui';
import { useStore } from '../../data/store';
import { fitLanes, isTimedSingleDay, layoutRow, layoutTimed, type Segment } from '../../domain/calendarLayout';
import {
  addDays, addMonths, fmtDate, fmtTime, makeDate, minutesToTime, monthGrid, MONTHS, MONTHS_SHORT, parts, startOfWeek, toEpochDay, WEEKDAYS, WEEKDAYS_SHORT, weekday,
} from '../../domain/dates';
import { isDone, isOverdue, occursOn } from '../../domain/tasks';
import type { CalendarView, Category, ISODate, Task } from '../../domain/types';

interface Props {
  hidden: Set<string>;
  toggleCategory(id: string): void;
  selected: ISODate;
  setSelected(d: ISODate): void;
  view: CalendarView;
  setView(v: CalendarView): void;
}

export function CalendarPage({ hidden, toggleCategory, selected, setSelected, view, setView }: Props) {
  const { data, today } = useStore();
  const { openNew } = useEditor();
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const tasks = useMemo(() => data.tasks.filter((t) => !hidden.has(t.categoryId)), [data.tasks, hidden]);
  const p = parts(selected);
  const ws = data.settings.weekStartsOn;

  const step = (dir: -1 | 1) => {
    if (view === 'month') {
      const m = addMonths(p.year, p.month, dir);
      const day = Math.min(p.day, new Date(Date.UTC(m.year, m.month + 1, 0)).getUTCDate());
      setSelected(makeDate(m.year, m.month, day));
    } else setSelected(addDays(selected, view === 'week' ? 7 * dir : dir));
  };

  // Keyboard shortcuts on the calendar: ←/→ change period, T = today.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.querySelector('.backdrop, .dialog-wrap')) return;
      if (e.key === 'ArrowLeft' && e.altKey) step(-1);
      else if (e.key === 'ArrowRight' && e.altKey) step(1);
      else if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) setSelected(today);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  let title: JSX.Element;
  if (view === 'month') title = <>{MONTHS[p.month]} <span className="yr">{p.year}</span></>;
  else if (view === 'week') {
    const s = startOfWeek(selected, ws), e = addDays(s, 6);
    const ps = parts(s), pe = parts(e);
    title = ps.month === pe.month
      ? <>{MONTHS_SHORT[ps.month]} {ps.day}–{pe.day} <span className="yr">{pe.year}</span></>
      : <>{MONTHS_SHORT[ps.month]} {ps.day} – {MONTHS_SHORT[pe.month]} {pe.day} <span className="yr">{pe.year}</span></>;
  } else title = <>{WEEKDAYS[weekday(selected)]}, {p.day} {MONTHS_SHORT[p.month]} <span className="yr">{p.year}</span></>;

  return (
    <div className="cal-wrap">
      <div className="cal-toolbar">
        <div className="hstack" style={{ gap: 4 }}>
          <button className="icon-btn bordered" aria-label={`Previous ${view}`} onClick={() => step(-1)}><IChevL /></button>
          <button className="icon-btn bordered" aria-label={`Next ${view}`} onClick={() => step(1)}><IChevR /></button>
        </div>
        <button className="btn" onClick={() => setSelected(today)}>Today</button>
        <button className="cal-title" aria-haspopup="dialog" aria-label="Choose month and year" onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}>
          {title}<IChevD size={16} style={{ color: 'var(--ink-3)', alignSelf: 'center' }} />
        </button>
        <span style={{ flex: 1 }} />
        <div className="legend-inline" aria-label="Filter by category">
          {data.categories.filter((c) => c.isActive).map((c) => (
            <button key={c.id} className="chip" aria-pressed={!hidden.has(c.id)} onClick={() => toggleCategory(c.id)}
              style={{ ...(hidden.has(c.id) ? { background: 'var(--surface)', color: 'var(--ink-3)', boxShadow: 'inset 0 0 0 1px var(--line-strong)', textDecoration: 'line-through' } : catVars(c.color)), border: 0, cursor: 'pointer' }}
              title={hidden.has(c.id) ? `Show ${c.name}` : `Hide ${c.name}`}>
              <CatIcon icon={c.icon} size={11} />{c.name}
            </button>
          ))}
          <span className="chip" style={catVars(data.settings.milestoneColor)} title="Milestones use the butter colour"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg>Milestone</span>
        </div>
        <div className="seg" role="group" aria-label="Calendar view">
          {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      {view === 'month' && (
        <MonthView year={p.year} month={p.month} selected={selected} today={today} tasks={tasks} weekStartsOn={ws}
          categories={data.categories} milestoneColor={data.settings.milestoneColor}
          onSelect={setSelected}
          onCreate={(s, e) => { setSelected(s); openNew({ startDate: s, endDate: e }); }} />
      )}
      {view !== 'month' && (
        <TimeGrid days={view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selected, ws), i)) : [selected]}
          selected={selected} today={today} tasks={tasks} categories={data.categories} milestoneColor={data.settings.milestoneColor}
          onSelect={setSelected}
          onCreate={(d, startTime) => openNew(startTime ? { startDate: d, endDate: d, allDay: false, startTime, endTime: minutesToTime(Math.min(23 * 60 + 59, toMin(startTime) + 60)) } : { startDate: d, endDate: d })}
          onDayView={(d) => { setSelected(d); setView('day'); }} />
      )}

      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)} className="picker" label="Month and year">
          <MonthYearPicker value={selected} onPick={(d) => { setSelected(d); setPicker(null); }} />
        </Popover>
      )}
    </div>
  );
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function MonthYearPicker({ value, onPick }: { value: ISODate; onPick(d: ISODate): void }) {
  const p = parts(value);
  const [year, setYear] = useState(p.year);
  return (
    <div>
      <div className="picker-year">
        <button className="icon-btn" aria-label="Previous year" onClick={() => setYear(year - 1)}><IChevL /></button>
        <span className="tnum">{year}</span>
        <button className="icon-btn" aria-label="Next year" onClick={() => setYear(year + 1)}><IChevR /></button>
      </div>
      <div className="picker-months">
        {MONTHS_SHORT.map((m, i) => (
          <button key={m} aria-pressed={year === p.year && i === p.month} onClick={() => onPick(makeDate(year, i, Math.min(p.day, new Date(Date.UTC(year, i + 1, 0)).getUTCDate())))}>{m}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Bar (shared by month grid, all-day lane and popovers) ---------------- */

export function TaskBar({ seg, task, cat, milestoneColor, style, today, onOpen }: {
  seg?: Segment; task: Task; cat: Category; milestoneColor: string; style?: CSSProperties; today: ISODate; onOpen(id: string): void;
}) {
  const timed = isTimedSingleDay(task);
  const done = task.status === 'completed';
  const overdue = isOverdue(task, today);
  const cls = ['bar', timed && 'timed', done && 'done', task.isMilestone && 'milestone', overdue && 'overdue',
    seg?.continuesBefore && 'cont-before', seg?.continuesAfter && 'cont-after'].filter(Boolean).join(' ');
  const colors = task.isMilestone ? catVars(milestoneColor) : catVars(cat.color);
  const label = `${task.title}, ${cat.name}${task.isMilestone ? ', milestone' : ''}, ${fmtDate(task.startDate)}${task.endDate !== task.startDate ? ` to ${fmtDate(task.endDate)}` : ''}${!task.allDay ? ` at ${fmtTime(task.startTime)}` : ''}${done ? ', completed' : ''}${overdue ? ', overdue' : ''}`;
  return (
    <button className={cls} style={{ ...colors, ...style }} aria-label={label} title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>
      {timed ? <span className="dot" /> : task.isMilestone ? <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor" /></svg> : <CatIcon icon={cat.icon} size={11} />}
      {done && <ICheck size={11} />}
      {overdue && <IAlert size={11} />}
      {timed && <span className="time">{fmtTime(task.startTime)}</span>}
      {!timed && !task.allDay && !seg?.continuesBefore && <span className="time">{fmtTime(task.startTime)}</span>}
      <span className="t">{seg?.continuesBefore ? '← ' : ''}{task.title}</span>
    </button>
  );
}

/* ---------------- Month view ---------------- */

function MonthView({ year, month, selected, today, tasks, weekStartsOn, categories, milestoneColor, onSelect, onCreate }: {
  year: number; month: number; selected: ISODate; today: ISODate; tasks: Task[]; weekStartsOn: 0 | 1; categories: Category[]; milestoneColor: string;
  onSelect(d: ISODate): void; onCreate(start: ISODate, end: ISODate): void;
}) {
  const { openTask } = useEditor();
  const weeks = useMemo(() => monthGrid(year, month, weekStartsOn), [year, month, weekStartsOn]);
  const weeksRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ lanes: 3, head: 34, lane: 24 });
  const [more, setMore] = useState<{ day: ISODate; rect: DOMRect } | null>(null);
  const [drag, setDrag] = useState<{ a: ISODate; b: ISODate } | null>(null);
  const cat = (id: string) => categories.find((c) => c.id === id) ?? categories[categories.length - 1];

  // Fit as many event lanes as the row height allows.
  useLayoutEffect(() => {
    const el = weeksRef.current;
    if (!el) return;
    const measure = () => {
      const small = window.innerWidth <= 560;
      const head = small ? 28 : 34, lane = small ? 19 : 24;
      const rowH = el.clientHeight / weeks.length;
      setMetrics({ head, lane, lanes: Math.max(2, Math.floor((rowH - head - 4) / lane)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks.length]);

  useEffect(() => {
    if (!drag) return;
    const up = () => {
      const [s, e] = drag.a <= drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
      setDrag(null);
      onCreate(s, e);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [drag, onCreate]);

  const inDrag = (d: ISODate) => drag && toEpochDay(d) >= Math.min(toEpochDay(drag.a), toEpochDay(drag.b)) && toEpochDay(d) <= Math.max(toEpochDay(drag.a), toEpochDay(drag.b));
  const dows = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  return (
    <div className="month" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
      <div className="dow-row" role="row">
        {dows.map((d) => <div key={d} role="columnheader"><span className="full">{WEEKDAYS_SHORT[d]}</span></div>)}
      </div>
      <div className="weeks" ref={weeksRef} style={{ ['--row-h' as any]: `${metrics.head + 2 * metrics.lane + 8}px` }}>
        {weeks.map((week) => {
          const { segments } = layoutRow(week, tasks);
          const { visible, more: moreCounts } = fitLanes(segments, 7, metrics.lanes);
          return (
            <div className="week" role="row" key={week[0]}>
              {week.map((d, i) => {
                const pd = parts(d);
                const out = pd.month !== month;
                const dayTasks = tasks.filter((t) => occursOn(t, d));
                const doneCount = dayTasks.filter((t) => t.status === 'completed').length;
                const cls = ['day', out && 'out', d === today && 'today', d === selected && 'sel', inDrag(d) && 'inrange', (weekday(d) === 0 || weekday(d) === 6) && 'weekend'].filter(Boolean).join(' ');
                return (
                  <div key={d} className={cls} role="gridcell" tabIndex={d === selected ? 0 : -1} data-date={d}
                    aria-label={`${fmtDate(d, { weekday: true })}${d === today ? ', today' : ''}, ${dayTasks.length} item${dayTasks.length === 1 ? '' : 's'}. Press Enter to add a task.`}
                    aria-selected={d === selected}
                    onPointerDown={(e) => { if (e.button === 0) { onSelect(d); setDrag({ a: d, b: d }); } }}
                    onPointerEnter={() => drag && setDrag({ ...drag, b: d })}
                    onKeyDown={(e) => {
                      const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCreate(d, d); }
                      else if (move[e.key] && !e.altKey) {
                        e.preventDefault();
                        const nd = addDays(d, move[e.key]);
                        onSelect(nd);
                        requestAnimationFrame(() => (document.querySelector(`[data-date="${nd}"]`) as HTMLElement | null)?.focus());
                      }
                    }}>
                    <div className="day-head">
                      <button className="day-num" tabIndex={-1} aria-label={`Add task on ${fmtDate(d)}`} onClick={(e) => { e.stopPropagation(); }}>
                        {pd.day === 1 ? `${MONTHS_SHORT[pd.month]} 1` : pd.day}
                      </button>
                      {doneCount > 0 && <span className="day-done" title={`${doneCount} of ${dayTasks.length} completed`}><ICheck size={10} />{doneCount}/{dayTasks.length}</span>}
                    </div>
                    {moreCounts[i] > 0 && (
                      <button className="more" style={{ top: metrics.head + (metrics.lanes - 1) * metrics.lane }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setMore({ day: d, rect: e.currentTarget.getBoundingClientRect() }); }}>
                        + {moreCounts[i]} more
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="bars">
                {visible.map((s) => (
                  <TaskBar key={s.task.id} seg={s} task={s.task} cat={cat(s.task.categoryId)} milestoneColor={milestoneColor} today={today} onOpen={openTask}
                    style={{
                      top: metrics.head + s.lane * metrics.lane,
                      left: `calc(${(s.startCol / 7) * 100}% + ${s.continuesBefore ? 0 : 4}px)`,
                      width: `calc(${((s.endCol - s.startCol + 1) / 7) * 100}% - ${(s.continuesBefore ? 0 : 4) + (s.continuesAfter ? 0 : 4)}px)`,
                    }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {more && (
        <Popover anchor={more.rect} onClose={() => setMore(null)} label={`Tasks on ${fmtDate(more.day)}`}>
          <h3>{fmtDate(more.day, { weekday: true })}
            <button className="btn btn-sm btn-soft" onClick={() => { const d = more.day; setMore(null); onCreate(d, d); }}><IPlus size={12} />Add</button>
          </h3>
          <div className="pop-list">
            {tasks.filter((t) => occursOn(t, more.day)).sort((a, b) => (a.allDay === b.allDay ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.allDay ? -1 : 1)).map((t) => (
              <TaskBar key={t.id} task={t} cat={cat(t.categoryId)} milestoneColor={milestoneColor} today={today} onOpen={(id) => { setMore(null); openTask(id); }} />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ---------------- Week & day time grid ---------------- */

const HOUR = 48;

function TimeGrid({ days, selected, today, tasks, categories, milestoneColor, onSelect, onCreate, onDayView }: {
  days: ISODate[]; selected: ISODate; today: ISODate; tasks: Task[]; categories: Category[]; milestoneColor: string;
  onSelect(d: ISODate): void; onCreate(d: ISODate, startTime?: string): void; onDayView(d: ISODate): void;
}) {
  const { openTask } = useEditor();
  const bodyRef = useRef<HTMLDivElement>(null);
  const cat = (id: string) => categories.find((c) => c.id === id) ?? categories[categories.length - 1];
  const [nowMin, setNowMin] = useState(() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); });
  useEffect(() => { const t = setInterval(() => { const n = new Date(); setNowMin(n.getHours() * 60 + n.getMinutes()); }, 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 7 * HOUR; }, []);

  const allDayTasks = tasks.filter((t) => !isTimedSingleDay(t));
  const { segments, laneCount } = layoutRow(days, allDayTasks);
  const cols = days.length;

  return (
    <div className="tg" style={{ ['--cols' as any]: cols }}>
      <div className="tg-head">
        <div />
        {days.map((d) => (
          <div key={d} className={`col ${d === today ? 'today' : ''} ${d === selected && cols > 1 ? 'sel' : ''}`} role="button" tabIndex={0}
            aria-label={`Open day view for ${fmtDate(d, { weekday: true })}`}
            onClick={() => (cols > 1 ? onDayView(d) : onSelect(d))} onKeyDown={(e) => e.key === 'Enter' && onDayView(d)}>
            <div className="wd">{WEEKDAYS_SHORT[weekday(d)]}</div>
            <div className="dn">{parts(d).day}</div>
          </div>
        ))}
      </div>
      <div className="tg-allday" style={{ minHeight: Math.max(30, laneCount * 24 + 8) }}>
        <div className="lab">All day</div>
        {days.map((d) => <div key={d} className="cell" onClick={() => onCreate(d)} title={`Add an all-day task on ${fmtDate(d)}`} />)}
        <div className="bars">
          {segments.map((s) => (
            <TaskBar key={s.task.id} seg={s} task={s.task} cat={cat(s.task.categoryId)} milestoneColor={milestoneColor} today={today} onOpen={openTask}
              style={{ top: 4 + s.lane * 24, left: `calc(${(s.startCol / cols) * 100}% + 3px)`, width: `calc(${((s.endCol - s.startCol + 1) / cols) * 100}% - 6px)` }} />
          ))}
        </div>
      </div>
      <div className="tg-body" ref={bodyRef}>
        <div className="tg-grid">
          <div className="tg-hours">
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="tg-hour">{h === 0 ? '' : fmtTime(`${String(h).padStart(2, '0')}:00`)}</div>)}
          </div>
          {days.map((d) => {
            const blocks = layoutTimed(tasks.filter((t) => t.startDate === d));
            return (
              <div key={d} className="tg-col">
                {Array.from({ length: 48 }, (_, i) => (
                  <div key={i} className="tg-slot" onClick={() => onCreate(d, minutesToTime(i * 30))} title={`Add a task at ${fmtTime(minutesToTime(i * 30))}`} />
                ))}
                {blocks.map((b) => {
                  const c = cat(b.task.categoryId);
                  return (
                    <button key={b.task.id} className={`tg-event ${isDone(b.task) ? 'done' : ''}`}
                      style={{ ...catVars(c.color), top: (b.top / 60) * HOUR, height: Math.max(20, ((b.bottom - b.top) / 60) * HOUR - 2), left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)` }}
                      onClick={() => openTask(b.task.id)} aria-label={`${b.task.title}, ${fmtTime(b.task.startTime)} to ${fmtTime(b.task.endTime)}, ${c.name}`}>
                      <strong>{b.task.status === 'completed' && <ICheck size={10} />} {b.task.title}</strong>
                      <span className="mono">{fmtTime(b.task.startTime)}–{fmtTime(b.task.endTime)}</span>
                    </button>
                  );
                })}
                {d === today && <div className="tg-now" style={{ top: (nowMin / 60) * HOUR }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

