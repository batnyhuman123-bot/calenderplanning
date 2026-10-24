import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { IAlert, IBlock, ICheck, IChevD, IChevR, IPlay } from '../../components/Icons';
import { catVars } from '../../components/ui';
import { deepFor, strokeFor } from '../../domain/colors';
import { addDays, fmtDate, fromEpochDay, toEpochDay, weekday } from '../../domain/dates';
import { PX_PER_DAY, timelineHeaders, type GanttRow } from '../../domain/gantt';
import { durationDays } from '../../domain/tasks';
import type { GanttZoom, ISODate, Task } from '../../domain/types';
import { STATUS_LABEL } from '../../domain/types';

interface Props {
  rows: GanttRow[];
  range: { start: ISODate; end: ISODate; days: number };
  zoom: GanttZoom;
  today: ISODate;
  /** Pastel bar colour for a task (phase or category colour). */
  colorOf(t: Task): string;
  /** Band colour for project/phase summary rows. */
  rowColor?(r: GanttRow): string | undefined;
  /** Scroll the timeline so this date is at the left edge (nonce re-triggers). */
  scrollTo?: { date: ISODate; nonce: number };
  milestoneColor: string;
  showBaseline: boolean;
  collapsed: Set<string>;
  onToggle(key: string): void;
  onOpen(taskId: string): void;
  onReschedule(taskId: string, start: ISODate, end: ISODate): void;
  emptyState?: JSX.Element;
}

type DragMode = 'move' | 'start' | 'end';
interface Drag { id: string; mode: DragMode; x0: number; start: ISODate; end: ISODate; delta: number; moved: boolean }

function useRowHeight() {
  const get = () => (typeof window !== 'undefined' && window.innerWidth <= 860 ? 34 : 36);
  const [h, setH] = useState(get);
  useEffect(() => { const on = () => setH(get()); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  return h;
}

const STATE_ICON = { completed: ICheck, in_progress: IPlay, blocked: IBlock, overdue: IAlert, normal: null } as const;
const STATE_LABEL = { completed: 'Completed', in_progress: 'In progress', blocked: 'Blocked', overdue: 'Overdue', normal: '' } as const;

export function GanttChart({ rows, range, zoom, today, colorOf, rowColor, scrollTo, milestoneColor, showBaseline, collapsed, onToggle, onOpen, onReschedule, emptyState }: Props) {
  const ppd = PX_PER_DAY[zoom];
  const rowH = useRowHeight();
  const s0 = toEpochDay(range.start);
  const width = Math.ceil(range.days * ppd);
  const height = Math.max(rows.length * rowH, 120);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; row: GanttRow } | null>(null);
  const headers = useMemo(() => timelineHeaders(range.start, range.days, zoom), [range.start, range.days, zoom]);
  const x = (d: ISODate) => (toEpochDay(d) - s0) * ppd;

  // Keep today in view when the zoom or range changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const leftW = (el.querySelector('.g-left') as HTMLElement | null)?.offsetWidth ?? 0;
    const tx = x(today);
    const target = rows.length ? Math.min(tx, x(rows[0].start)) : tx;
    el.scrollLeft = Math.max(0, target - (el.clientWidth - leftW) * 0.15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, range.start]);

  // "Display week": jump the timeline to a requested date.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrollTo) return;
    el.scrollTo({ left: Math.max(0, x(scrollTo.date)), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo?.nonce]);

  /** Dates for a task, including a live drag preview. */
  const datesOf = (t: Task): [ISODate, ISODate] => {
    if (drag && drag.id === t.id) {
      const d = drag.delta;
      if (drag.mode === 'move') return [addDays(drag.start, d), addDays(drag.end, d)];
      if (drag.mode === 'start') { const s = addDays(drag.start, d); return [s > drag.end ? drag.end : s, drag.end]; }
      const e = addDays(drag.end, d);
      return [drag.start, e < drag.start ? drag.start : e];
    }
    return [t.startDate, t.endDate];
  };

  const beginDrag = (e: RPE, t: Task, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setTip(null);
    setDrag({ id: t.id, mode, x0: e.clientX, start: t.startDate, end: t.endDate, delta: 0, moved: false });
  };
  const moveDrag = (e: RPE) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const delta = Math.round(dx / ppd);
    if (delta !== drag.delta || (!drag.moved && Math.abs(dx) > 3)) setDrag({ ...drag, delta, moved: drag.moved || Math.abs(dx) > 3 });
  };
  const endDrag = (t: Task) => {
    if (!drag) return;
    const [s, e] = datesOf(t);
    const d = drag;
    setDrag(null);
    if (!d.moved) { onOpen(t.id); return; }
    if (s !== t.startDate || e !== t.endDate) onReschedule(t.id, s, e);
  };

  const onBarKey = (e: React.KeyboardEvent, t: Task) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id); return; }
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    if (e.shiftKey && !t.isMilestone) {
      const end = addDays(t.endDate, d);
      if (end >= t.startDate) onReschedule(t.id, t.startDate, end);
    } else onReschedule(t.id, addDays(t.startDate, d), addDays(t.endDate, d));
  };

  // Row index lookup for dependency lines.
  const rowIndex = new Map(rows.map((r, i) => [r.key, i]));
  const taskRows = rows.filter((r) => r.task);
  const deps: { d: string; bad: boolean; key: string }[] = [];
  for (const r of taskRows) {
    const t = r.task!;
    const [ts] = datesOf(t);
    for (const pid of t.dependencyIds) {
      const pi = rowIndex.get(pid);
      if (pi === undefined) continue;
      const pr = rows[pi];
      const [ps, pe] = datesOf(pr.task!);
      const x1 = pr.task!.isMilestone ? x(ps) + ppd / 2 + 8 : x(pe) + ppd;
      const y1 = pi * rowH + rowH / 2;
      const x2 = t.isMilestone ? x(ts) + ppd / 2 - 8 : x(ts);
      const y2 = rowIndex.get(t.id)! * rowH + rowH / 2;
      const bad = toEpochDay(ts) <= toEpochDay(pe);
      let d: string;
      if (x2 - 6 >= x1 + 6) {
        const xm = x1 + 6;
        d = `M${x1} ${y1} H${xm} V${y2} H${x2 - 1}`;
      } else {
        const ym = y2 > y1 ? y2 - rowH / 2 : y2 + rowH / 2;
        d = `M${x1} ${y1} H${x1 + 6} V${ym} H${x2 - 8} V${y2} H${x2 - 1}`;
      }
      deps.push({ d, bad, key: `${pid}->${t.id}` });
    }
  }

  const lowerLines = headers.lower.map((h) => h.startDay);
  const upperLines = new Set(headers.upper.map((h) => h.startDay));
  const todayX = x(today) + ppd / 2;
  const todayVisible = toEpochDay(today) >= s0 && toEpochDay(today) < s0 + range.days;

  return (
    <div className="gantt" ref={scrollRef} style={{ ['--row-h' as any]: `${rowH}px` }}>
      <div className="g-inner" style={{ width: 'max-content', minWidth: '100%' }}>
        <div className="g-head">
          <div className="g-head-left">
            <div className="g-cols" role="row">
              <span role="columnheader">Task</span><span role="columnheader">Progress</span><span role="columnheader">Start</span>
              <span role="columnheader">End</span><span role="columnheader" title="Calendar days, inclusive">Days</span>
            </div>
          </div>
          <div className="g-scale" style={{ width }}>
            <div className="g-band">
              {headers.upper.map((h) => <div key={h.startDay} className="g-hcell" style={{ left: h.startDay * ppd, width: h.days * ppd }}>{h.label}</div>)}
            </div>
            <div className="g-band">
              {headers.lower.map((h) => {
                const isToday = zoom === 'day' && fromEpochDay(s0 + h.startDay) === today;
                return <div key={h.startDay} className={`g-hcell ${isToday ? 'today' : ''}`} title={h.title} style={{ left: h.startDay * ppd, width: h.days * ppd }}>{h.days * ppd >= 16 ? h.label : ''}</div>;
              })}
            </div>
            {headers.letters.length > 0 && (
              <div className="g-band letters">
                {headers.letters.map((h) => {
                  const isToday = fromEpochDay(s0 + h.startDay) === today;
                  return <div key={h.startDay} className={`g-hcell ${isToday ? 'today' : ''}`} style={{ left: h.startDay * ppd, width: h.days * ppd }} aria-hidden="true">{h.label}</div>;
                })}
              </div>
            )}

          </div>
        </div>

        <div className="g-body">
          <div className="g-left" role="rowgroup">
            {rows.map((r) => {
              const t = r.task;
              const st = r.state ?? 'normal';
              const Icon = STATE_ICON[st];
              return (
                <div key={r.key} className={`g-row ${r.kind} ${hover === r.key ? 'hover' : ''}`} role="row" onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}
                  style={!t && rowColor?.(r) ? { background: rowColor(r), ['--band-ink' as any]: strokeFor(rowColor(r)!) } : undefined}>
                  <div className="g-cols" style={{ height: '100%' }}>
                    <span className="g-name" style={{ paddingLeft: 8 + r.depth * 16 }} role="cell">
                      {r.hasChildren ? (
                        <button className="g-tog" aria-label={collapsed.has(r.key) ? `Expand ${r.label}` : `Collapse ${r.label}`} aria-expanded={!collapsed.has(r.key)} onClick={() => onToggle(r.key)}>
                          {collapsed.has(r.key) ? <IChevR size={13} /> : <IChevD size={13} />}
                        </button>
                      ) : <span style={{ width: 18, flex: 'none' }} />}
                      <span className="wbs">{r.wbs}</span>
                      {t && Icon && (
                        <span className="g-status" title={STATE_LABEL[st]} style={{ color: st === 'blocked' ? 'var(--danger)' : st === 'overdue' ? 'var(--peach-ink)' : st === 'completed' ? 'var(--sage-ink)' : 'var(--blue-ink)' }}>
                          <Icon size={12} /><span className="sr-only">{STATE_LABEL[st]}</span>
                        </span>
                      )}
                      {t ? (
                        <button className="nm" onClick={() => onOpen(t.id)} title={`${r.label} · ${STATE_LABEL[st] || STATUS_LABEL[t.status]}`}>{t.isMilestone ? '◆ ' : ''}{r.label}</button>
                      ) : <span className="nm" title={r.label}>{r.label}</span>}
                    </span>
                    <span className="g-prog" role="cell" aria-label={`${r.progress}% complete`}>
                      <span className="g-prog-bar"><i style={{ width: `${r.progress}%`, background: t ? strokeFor(colorOf(t)) : rowColor?.(r) ? strokeFor(rowColor(r)!) : '#9D8DC9' }} /></span>
                      <span className="g-cell-mono">{r.progress}%</span>
                    </span>
                    <span className="g-cell-mono" role="cell">{fmtDate(r.start, { year: false })}</span>
                    <span className="g-cell-mono" role="cell">{fmtDate(r.end, { year: false })}</span>
                    <span className="g-cell-mono" role="cell">{t ? durationDays(t) : toEpochDay(r.end) - toEpochDay(r.start) + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="g-timeline" style={{ width, height }} onPointerLeave={() => setTip(null)}>
            {zoom === 'day' && Array.from({ length: range.days }, (_, i) => i).filter((i) => { const w = weekday(fromEpochDay(s0 + i)); return w === 0 || w === 6; })
              .map((i) => <div key={`we${i}`} className="g-weekend" style={{ left: i * ppd, width: ppd }} />)}
            {rows.map((r, i) => (
              <div key={`bg${r.key}`} className={`g-rowbg ${r.kind === 'project' ? 'project' : ''} ${hover === r.key ? 'hover' : ''}`}
                style={{ top: i * rowH, height: rowH, ...(r.kind === 'phase' && rowColor?.(r) && hover !== r.key ? { background: rowColor(r), opacity: 0.35 } : {}) }} />
            ))}
            {lowerLines.map((d) => <div key={`gl${d}`} className={`g-gridline ${upperLines.has(d) ? 'major' : ''}`} style={{ left: d * ppd }} />)}
            {rows.map((_, i) => <div key={`rl${i}`} className="g-rowline" style={{ top: (i + 1) * rowH - 1 }} />)}
            {todayVisible && <div className="g-today-col" style={{ left: x(today), width: Math.max(ppd, 2) }} />}
            {todayVisible && <div className="g-today" style={{ left: todayX - 1 }} title={`Today, ${fmtDate(today)}`} />}

            <svg className="g-deps" width={width} height={height} aria-hidden="true">
              <defs>
                <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#9C94A3" /></marker>
                <marker id="arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#B0413E" /></marker>
              </defs>
              {deps.map((d) => (
                <path key={d.key} d={d.d} fill="none" stroke={d.bad ? '#B0413E' : '#9C94A3'} strokeWidth={1.2} strokeDasharray={d.bad ? '4 3' : undefined} markerEnd={`url(#${d.bad ? 'arr-bad' : 'arr'})`} />
              ))}
            </svg>

            {rows.map((r, i) => {
              const top = i * rowH;
              if (!r.task) {
                const left = x(r.start), w = Math.max(ppd, (toEpochDay(r.end) - toEpochDay(r.start) + 1) * ppd);
                return (
                  <div key={`s${r.key}`} className="g-summary" title={`${r.label}: ${fmtDate(r.start)} – ${fmtDate(r.end)}, ${r.progress}%`}
                    style={{ left, width: w, top: top + rowH / 2 - 5, ['--sum-bg' as any]: r.kind === 'phase' && rowColor?.(r) ? strokeFor(rowColor(r)!) : r.kind === 'project' ? '#CFC6E6' : '#D9D2EA', ['--sum-fill' as any]: r.kind === 'phase' && rowColor?.(r) ? deepFor(rowColor(r)!) : r.kind === 'project' ? '#9D8DC9' : '#AFA3CF' }}>
                    <span className="sfill" style={{ width: `${r.progress}%` }} />
                  </div>
                );
              }
              const t = r.task;
              const [s, e] = datesOf(t);
              const color = colorOf(t);
              const st = r.state ?? 'normal';
              const Icon = STATE_ICON[st];
              const dragging = drag?.id === t.id;
              const tipHandlers = {
                onPointerEnter: (ev: RPE) => !drag && setTip({ x: ev.clientX, y: ev.clientY, row: r }),
                onPointerMove: (ev: RPE) => { if (drag) moveDrag(ev); else setTip({ x: ev.clientX, y: ev.clientY, row: r }); },
                onPointerLeave: () => setTip(null),
              };
              const aria = `${t.title}. ${fmtDate(s)} to ${fmtDate(e)}. ${r.progress}% complete. ${STATE_LABEL[st] || STATUS_LABEL[t.status]}. Press Enter to edit; Alt+Arrow keys to move${t.isMilestone ? '' : ', Alt+Shift+Arrow keys to change the end date'}.`;
              const baseline = showBaseline && t.baselineStart && t.baselineEnd ? (
                <div key={`b${t.id}`} className="g-baseline" title={`Baseline ${fmtDate(t.baselineStart)} – ${fmtDate(t.baselineEnd)}`}
                  style={{ left: x(t.baselineStart), width: Math.max(4, (toEpochDay(t.baselineEnd) - toEpochDay(t.baselineStart) + 1) * ppd), top: top + rowH - 7 }} />
              ) : null;

              if (t.isMilestone) {
                const ms = t.status === 'completed';
                return [baseline, (
                  <button key={t.id} className={`g-ms ${ms ? 'done' : ''} ${dragging ? 'dragging' : ''}`} aria-label={aria}
                    style={{ left: x(s) + ppd / 2 - 8, top: top + rowH / 2 - 8, ['--ms-bg' as any]: milestoneColor }}
                    onPointerDown={(ev) => beginDrag(ev, t, 'move')} onPointerUp={() => endDrag(t)} onKeyDown={(ev) => onBarKey(ev, t)} {...tipHandlers}>
                    <span className="outside">{ms && <ICheck size={11} />}{st === 'overdue' && <IAlert size={11} />}{t.title} · {fmtDate(s, { year: false })}</span>
                  </button>
                )];
              }
              const left = x(s);
              const w = Math.max(ppd, (toEpochDay(e) - toEpochDay(s) + 1) * ppd);
              const inside = w >= 90;
              return [baseline, (
                <button key={t.id} className={`g-bar state-${st} ${dragging ? 'dragging' : ''}`} aria-label={aria}
                  style={{ ...catVars(color), left, width: w, top: top + (rowH - 22) / 2 - (showBaseline && t.baselineStart ? 3 : 0) }}
                  onPointerDown={(ev) => beginDrag(ev, t, 'move')} onPointerUp={() => endDrag(t)} onKeyDown={(ev) => onBarKey(ev, t)} {...tipHandlers}>
                  <span className={`fill ${r.progress >= 100 ? 'full' : ''}`} style={{ width: `${r.progress}%` }} />
                  {inside && <span className="lbl">{Icon && <Icon size={11} />}{t.title}</span>}
                  {!inside && <span className="outside">{Icon && <Icon size={11} />}{t.title}</span>}
                  {!r.hasChildren && <><span className="h l" onPointerDown={(ev) => beginDrag(ev, t, 'start')} onPointerUp={(ev) => { ev.stopPropagation(); endDrag(t); }} />
                  <span className="h r" onPointerDown={(ev) => beginDrag(ev, t, 'end')} onPointerUp={(ev) => { ev.stopPropagation(); endDrag(t); }} /></>}
                </button>
              )];
            })}
            {rows.length === 0 && emptyState && <div className="g-empty" style={{ inset: 0 }}>{emptyState}</div>}
          </div>
        </div>
      </div>

      {tip && !drag && tip.row.task && (
        <div className="g-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 290), top: tip.y + 16 }} role="tooltip">
          <strong>{tip.row.task.title}</strong>
          <div><span className="k">Start</span> {fmtDate(tip.row.task.startDate, { weekday: true })}</div>
          <div><span className="k">End</span> {fmtDate(tip.row.task.endDate, { weekday: true })}</div>
          <div><span className="k">Duration</span> {tip.row.task.isMilestone ? 'Milestone' : `${durationDays(tip.row.task)} days`}</div>
          <div><span className="k">Progress</span> {tip.row.progress}% · <span className="k">Status</span> {STATUS_LABEL[tip.row.task.status]}{tip.row.state === 'overdue' ? ' (overdue)' : ''}</div>
          {tip.row.task.dependencyIds.length > 0 && <div><span className="k">Depends on</span> {tip.row.task.dependencyIds.length} task{tip.row.task.dependencyIds.length > 1 ? 's' : ''}</div>}
          {tip.row.task.baselineStart && <div><span className="k">Baseline</span> {fmtDate(tip.row.task.baselineStart, { year: false })} – {fmtDate(tip.row.task.baselineEnd!, { year: false })}</div>}
        </div>
      )}
      {drag && (() => {
        const t = rows.find((r) => r.task?.id === drag.id)?.task;
        if (!t) return null;
        const [s, e] = datesOf(t);
        return <div className="g-tip" style={{ left: 'auto', right: 24, top: 'auto', bottom: 24, position: 'fixed' }}>{t.title}: {fmtDate(s)} – {fmtDate(e)}</div>;
      })()}
    </div>
  );
}
