import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { addDays, diffDays, fmtDate, maxDate, todayISO, toEpochDay } from '../domain/dates';
import { describeLink, impliedLag, isSummaryTask } from '../domain/schedule';
import {
  applyStatus, createsCycle, dependencyIssues, durationDays, isDescendant, newTask, subtreeIds, validateTask, workingDays, type FieldErrors,
} from '../domain/tasks';
import type { Priority, Task, TaskStatus } from '../domain/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../domain/types';
import { CatIcon, ICheck, ICopy, ITrash, IWarn, IX } from './Icons';
import { catVars, Field, Toggle, useConfirm, useEscape } from './ui';

type EditorState = { mode: 'create'; defaults: Partial<Task> & { startDate: string } } | { mode: 'edit'; id: string } | null;

interface EditorApi {
  openNew(defaults?: Partial<Task>): void;
  openTask(id: string): void;
}
const EditorCtx = createContext<EditorApi>({ openNew() {}, openTask() {} });
export const useEditor = () => useContext(EditorCtx);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EditorState>(null);
  const api = useMemo<EditorApi>(() => ({
    openNew: (defaults = {}) => setState({ mode: 'create', defaults: { startDate: todayISO(), ...defaults } }),
    openTask: (id) => setState({ mode: 'edit', id }),
  }), []);
  return (
    <EditorCtx.Provider value={api}>
      {children}
      {state && <TaskEditor key={state.mode === 'edit' ? state.id : 'new'} state={state} onClose={() => setState(null)} onOpen={(id) => setState({ mode: 'edit', id })} />}
    </EditorCtx.Provider>
  );
}

const STATUSES = Object.keys(STATUS_LABEL) as TaskStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];

function TaskEditor({ state, onClose, onOpen }: { state: NonNullable<EditorState>; onClose: () => void; onOpen: (id: string) => void }) {
  const store = useStore();
  const { data } = store;
  const confirm = useConfirm();

  const initial = useMemo<Task | null>(() => {
    if (state.mode === 'edit') return data.tasks.find((t) => t.id === state.id) ?? null;
    return newTask({ ...state.defaults, endDate: state.defaults.endDate ?? state.defaults.startDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [draft, setDraft] = useState<Task | null>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [kind, setKind] = useState<'simple' | 'project'>(initial?.projectId ? 'project' : 'simple');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const dirty = !!draft && !!initial && JSON.stringify(draft) !== JSON.stringify(initial);

  const asking = useRef(false);
  const requestClose = useCallback(async () => {
    if (asking.current) return;
    if (dirty) {
      asking.current = true;
      const r = await confirm({ title: 'Discard unsaved changes?', message: 'Your edits to this task have not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
      asking.current = false;
      if (r !== 'confirm') return;
    }
    onClose();
  }, [dirty, confirm, onClose]);
  useEscape(() => { void requestClose(); });

  if (!draft || !initial) {
    return (
      <div className="backdrop"><div className="drawer"><div className="drawer-body"><p>This task no longer exists.</p><button className="btn" onClick={onClose}>Close</button></div></div></div>
    );
  }

  const set = (patch: Partial<Task>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    const keys = Object.keys(patch);
    if (keys.some((k) => (errors as any)[k])) setErrors((e) => { const n = { ...e }; keys.forEach((k) => delete (n as any)[k]); return n; });
  };

  const today = store.today;
  const isNew = state.mode === 'create';
  const others = data.tasks.filter((t) => t.id !== draft.id);
  const projectTasks = draft.projectId ? others.filter((t) => t.projectId === draft.projectId) : [];
  const phases = data.phases.filter((p) => p.projectId === draft.projectId).sort((a, b) => a.order - b.order);
  const project = data.projects.find((p) => p.id === draft.projectId);
  const categories = data.categories.filter((c) => c.isActive || c.id === draft.categoryId);
  const withDraft = others.concat(draft);
  const issues = dependencyIssues(draft, withDraft);
  const auto = data.settings.autoSchedule;
  const summary = !isNew && isSummaryTask(data.tasks, draft.id);
  const byId = new Map(withDraft.map((t) => [t.id, t]));
  const lagNow = impliedLag(draft, byId);
  const linkText = auto && lagNow !== null ? describeLink({ ...draft, lagDays: lagNow }, withDraft) : null;
  const outOfProject = project && (toEpochDay(draft.startDate) < toEpochDay(project.startDate) || toEpochDay(draft.endDate) > toEpochDay(project.targetEndDate));

  const onStart = (v: string) => {
    if (!v) return set({ startDate: v });
    // Keep the duration when the start moves.
    const len = draft.startDate && draft.endDate ? diffDays(draft.startDate, draft.endDate) : 0;
    set({ startDate: v, endDate: draft.isMilestone ? v : addDays(v, Math.max(0, len)) });
  };

  const save = (t: Task = draft) => {
    const candidate = kind === 'simple' ? { ...t, projectId: null, phaseId: null, parentTaskId: null, dependencyIds: [] } : t;
    const errs = validateTask(candidate, data);
    if (kind === 'project' && !candidate.projectId) errs.projectId = 'Choose a project, or switch to “Simple item”.';
    setErrors(errs);
    if (Object.keys(errs).length) return false;
    const relinked = JSON.stringify([...candidate.dependencyIds].sort()) !== JSON.stringify([...initial.dependencyIds].sort());
    const saved = store.saveTask(candidate, { relinked });
    const warn = dependencyIssues(saved, others.concat(saved));
    store.notify(warn.length ? 'warning' : 'success', warn.length ? `Saved with a scheduling warning: ${warn[0].message}` : isNew ? `“${saved.title}” added` : 'Changes saved');
    onClose();
    return true;
  };

  const onDelete = async () => {
    const n = subtreeIds(data.tasks, draft.id).length - 1;
    const r = await confirm({
      title: `Delete “${initial.title}”?`,
      message: n > 0 ? `This also deletes ${n} subtask${n > 1 ? 's' : ''}. Links from other tasks that depend on it are removed.` : 'Links from other tasks that depend on it are removed.',
      confirmLabel: 'Delete', danger: true,
    });
    if (r !== 'confirm') return;
    const snapshot = data.tasks.filter((t) => subtreeIds(data.tasks, draft.id).includes(t.id) || t.dependencyIds.includes(draft.id));
    store.deleteTask(draft.id);
    store.notify('info', `Deleted “${initial.title}”`, { label: 'Undo', run: () => snapshot.forEach((t) => store.saveTask(t)) });
    onClose();
  };

  const onDuplicate = () => {
    const copy = store.duplicateTask(draft.id);
    if (copy) { store.notify('success', 'Task duplicated. You are now editing the copy.'); onOpen(copy.id); }
  };

  const durLabel = draft.isMilestone ? 'Milestone (single date)' : `${durationDays(draft)} calendar day${durationDays(draft) === 1 ? '' : 's'} · ${workingDays(draft.startDate, draft.endDate)} working`;

  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) void requestClose(); }}>
      <form
        className="drawer" role="dialog" aria-modal="true" aria-labelledby="editor-title" noValidate
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <div className="drawer-head">
          <h2 id="editor-title">{isNew ? 'New task' : 'Edit task'}</h2>
          {draft.isExample && <span className="badge example">Example</span>}
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => void requestClose()}><IX /></button>
        </div>

        <div className="drawer-body">
          {Object.keys(errors).length > 0 && (
            <div className="alert error" role="alert"><IWarn size={15} />Fix the highlighted fields to save this task.</div>
          )}
          <Field label="Title" htmlFor="f-title" required error={errors.title}>
            <input id="f-title" ref={titleRef} className="input title-input" value={draft.title} aria-invalid={!!errors.title}
              placeholder="What needs to happen?" onChange={(e) => set({ title: e.target.value })} maxLength={200} />
          </Field>

          <div className="field">
            <span className="field-label" id="cat-label">Category<span className="req" aria-hidden="true">*</span></span>
            <div className="cat-picker" role="radiogroup" aria-labelledby="cat-label">
              {categories.map((c) => (
                <button type="button" key={c.id} role="radio" aria-checked={draft.categoryId === c.id} className="cat-opt" style={catVars(c.color)} onClick={() => set({ categoryId: c.id })}>
                  <CatIcon icon={c.icon} size={12} />{c.name}
                </button>
              ))}
            </div>
            {errors.categoryId && <span className="err">{errors.categoryId}</span>}
          </div>

          <div className="section">
            <div className="section-title">Schedule</div>
            <div className="row2">
              <Field label="Start date" htmlFor="f-start" required error={errors.startDate}>
                <input id="f-start" type="date" className="input" value={draft.startDate} disabled={summary && auto} aria-invalid={!!errors.startDate} onChange={(e) => onStart(e.target.value)} />
              </Field>
              <Field label="End date" htmlFor="f-end" required error={errors.endDate} hint={durLabel}>
                <input id="f-end" type="date" className="input" value={draft.endDate} min={draft.startDate} disabled={draft.isMilestone || (summary && auto)} aria-invalid={!!errors.endDate} onChange={(e) => set({ endDate: e.target.value })} />
              </Field>
            </div>
            {summary && auto && <div className="alert info">This task has subtasks, so its dates and progress follow them automatically. Move it in the Gantt chart to shift all its subtasks together.</div>}
            {linkText && <div className="alert info" role="status">{linkText} Moving the prerequisite moves this task too.</div>}
            <Toggle id="f-allday" checked={draft.allDay} onChange={(v) => set({ allDay: v, startTime: v ? null : draft.startTime ?? '09:00', endTime: v ? null : draft.endTime ?? '10:00' })}
              label="All day" hint="Turn off to set start and end times." />
            {!draft.allDay && (
              <div className="row2">
                <Field label="Start time" htmlFor="f-st" required error={errors.startTime}>
                  <input id="f-st" type="time" className="input" value={draft.startTime ?? ''} aria-invalid={!!errors.startTime} onChange={(e) => set({ startTime: e.target.value || null })} />
                </Field>
                <Field label="End time" htmlFor="f-et" required error={errors.endTime}>
                  <input id="f-et" type="time" className="input" value={draft.endTime ?? ''} aria-invalid={!!errors.endTime} onChange={(e) => set({ endTime: e.target.value || null })} />
                </Field>
              </div>
            )}
            <Toggle id="f-ms" checked={draft.isMilestone} onChange={(v) => set({ isMilestone: v, endDate: v ? draft.startDate : draft.endDate })}
              label="Milestone" hint="A key date such as a deadline or sign-off. Shown as a diamond in the Gantt chart." />
          </div>

          <div className="section">
            <div className="section-title">Type</div>
            <div className="radio-cards" role="radiogroup" aria-label="Task type">
              <button type="button" role="radio" aria-checked={kind === 'simple'} className="radio-card" onClick={() => setKind('simple')}>
                <strong>Simple item</strong><span>A personal task, appointment or reminder.</span>
              </button>
              <button type="button" role="radio" aria-checked={kind === 'project'} className="radio-card" onClick={() => setKind('project')} disabled={!data.projects.length} title={!data.projects.length ? 'Create a Gantt chart first under Gantt Charts' : undefined}>
                <strong>Part of a project</strong><span>{data.projects.length ? 'Adds phase, hierarchy and dependencies.' : 'Create a Gantt chart first under Gantt Charts.'}</span>
              </button>
            </div>
            {kind === 'project' && (
              <>
                <div className="row2">
                  <Field label="Project" htmlFor="f-proj" required error={errors.projectId}>
                    <select id="f-proj" className="select" value={draft.projectId ?? ''} aria-invalid={!!errors.projectId}
                      onChange={(e) => set({ projectId: e.target.value || null, phaseId: null, parentTaskId: null, dependencyIds: [] })}>
                      <option value="">Choose a project…</option>
                      {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Phase" htmlFor="f-phase" error={errors.phaseId}>
                    <select id="f-phase" className="select" value={draft.phaseId ?? ''} disabled={!draft.projectId} onChange={(e) => set({ phaseId: e.target.value || null })}>
                      <option value="">No phase</option>
                      {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Parent task (makes this a subtask)" htmlFor="f-parent" error={errors.parentTaskId}>
                  <select id="f-parent" className="select" value={draft.parentTaskId ?? ''} disabled={!draft.projectId} onChange={(e) => set({ parentTaskId: e.target.value || null })}>
                    <option value="">None (top-level task)</option>
                    {projectTasks.filter((t) => !t.isMilestone && !isDescendant(data.tasks, t.id, draft.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </Field>
                <div className="field">
                  <span className="field-label">Depends on (finish-to-start)</span>
                  {projectTasks.length === 0 ? <span className="hint">No other tasks in this project yet.</span> : (
                    <div className="dep-list">
                      {projectTasks.map((t) => {
                        const checked = draft.dependencyIds.includes(t.id);
                        const cyc = !checked && createsCycle(withDraft, draft.id, t.id);
                        return (
                          <label key={t.id} className={`dep-opt ${cyc ? 'disabled' : ''}`}>
                            <input type="checkbox" checked={checked} disabled={cyc}
                              onChange={(e) => {
                              const deps = e.target.checked ? [...draft.dependencyIds, t.id] : draft.dependencyIds.filter((x) => x !== t.id);
                              const preds = deps.map((id) => byId.get(id)).filter(Boolean) as Task[];
                              if (auto && preds.length) {
                                // Linked: snap to start right after the latest prerequisite, keeping the duration.
                                const start = addDays(maxDate(...preds.map((p) => p.endDate)), 1);
                                if (toEpochDay(draft.startDate) < toEpochDay(start)) {
                                  const len = diffDays(draft.startDate, draft.endDate);
                                  set({ dependencyIds: deps, startDate: start, endDate: draft.isMilestone ? start : addDays(start, len) });
                                  return;
                                }
                              }
                              set({ dependencyIds: deps });
                            }} />
                            <span>{t.title}</span>
                            <span className="why">{cyc ? 'Would create a loop' : `ends ${fmtDate(t.endDate, { year: false })}`}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {errors.dependencyIds && <span className="err">{errors.dependencyIds}</span>}
                </div>
              </>
            )}
            <Toggle id="f-gantt" checked={draft.includeInGantt} onChange={(v) => set({ includeInGantt: v })}
              label="Include in Gantt Chart" hint="Shows this task in Gantt Chart View, its project timeline and the Excel export. It always stays in the calendar." />
            {issues.length > 0 && kind === 'project' && (
              <div className="alert warn" role="status"><IWarn size={15} /><div>{issues.map((i, k) => <div key={k}>{i.message}</div>)}</div></div>
            )}
            {outOfProject && kind === 'project' && (
              <div className="alert info"><IWarn size={15} />These dates fall outside the project window ({fmtDate(project!.startDate)} – {fmtDate(project!.targetEndDate)}).</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">Progress</div>
            <div className="row2">
              <Field label="Status" htmlFor="f-status">
                <select id="f-status" className="select" value={draft.status} onChange={(e) => setDraft(applyStatus(draft, e.target.value as TaskStatus, todayISO()))}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </Field>
              <Field label="Priority" htmlFor="f-prio">
                <select id="f-prio" className="select" value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                </select>
              </Field>
            </div>
            <Field label={`Progress: ${draft.progress}%`} htmlFor="f-prog" error={errors.progress}>
              <input id="f-prog" type="range" className="range" min={0} max={100} step={5} value={draft.progress}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const patch: Partial<Task> = { progress: v };
                  if (v > 0 && draft.status === 'not_started') Object.assign(patch, { status: 'in_progress', actualStart: draft.actualStart ?? today });
                  set(patch);
                }} />
            </Field>
            <div className="row2">
              <Field label="Actual start" htmlFor="f-as" hint="Recorded when work starts">
                <input id="f-as" type="date" className="input" value={draft.actualStart ?? ''} onChange={(e) => set({ actualStart: e.target.value || null })} />
              </Field>
              <Field label="Actual finish" htmlFor="f-ae" hint="Recorded on completion">
                <input id="f-ae" type="date" className="input" value={draft.actualEnd ?? ''} onChange={(e) => set({ actualEnd: e.target.value || null })} />
              </Field>
            </div>
            {draft.baselineStart && (
              <div className="hstack" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-2)' }}>
                Baseline: {fmtDate(draft.baselineStart)} – {fmtDate(draft.baselineEnd!)}
                {draft.baselineStart !== draft.startDate || draft.baselineEnd !== draft.endDate
                  ? <span className="badge overdue">Variance {diffDays(draft.baselineEnd!, draft.endDate) > 0 ? '+' : ''}{diffDays(draft.baselineEnd!, draft.endDate)}d</span>
                  : <span className="badge status-completed">On baseline</span>}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ baselineStart: null, baselineEnd: null })}>Clear baseline</button>
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-title">Details</div>
            <Field label="Description" htmlFor="f-desc">
              <textarea id="f-desc" className="textarea" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label="Reminder" htmlFor="f-rem" error={errors.reminderAt} hint="Shown as a banner while the planner is open. No background or push notifications.">
              <input id="f-rem" type="datetime-local" className="input" value={draft.reminderAt ?? ''} onChange={(e) => set({ reminderAt: e.target.value || null, reminderDismissed: false })} />
            </Field>
            <Field label="Notes" htmlFor="f-notes">
              <textarea id="f-notes" className="textarea" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="drawer-foot">
          {!isNew && (
            <>
              <button type="button" className="btn btn-danger" onClick={onDelete}><ITrash size={14} />Delete</button>
              <button type="button" className="btn btn-ghost" onClick={onDuplicate}><ICopy size={14} />Duplicate</button>
              {draft.status !== 'completed' && (
                <button type="button" className="btn btn-ghost" onClick={() => save(applyStatus(draft, 'completed', todayISO()))}><ICheck size={14} />Mark complete</button>
              )}
            </>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => void requestClose()}>Cancel</button>
          <button type="submit" className="btn btn-primary">{isNew ? 'Save task' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}
