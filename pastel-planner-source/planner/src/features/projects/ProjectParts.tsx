import { useState } from 'react';
import { IChevD, IChevR, IPlus, ITrash } from '../../components/Icons';
import { Field, useConfirm, useEscape } from '../../components/ui';
import { useStore } from '../../data/store';
import { addDays, isValidISODate, toEpochDay } from '../../domain/dates';
import { phaseColor } from '../../domain/gantt';
import { nowISO, uid } from '../../domain/tasks';
import type { Phase, Priority, Project, ProjectStatus } from '../../domain/types';
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL } from '../../domain/types';

/** Shared project building blocks used by the Gantt Charts workspace. */
export function PhaseEditor({ projectId, phases, project }: { projectId: string; phases: Phase[]; project: Project }) {
  const store = useStore();
  const confirm = useConfirm();
  const [open, setOpen] = useState(true);
  const add = () => {
    const last = phases[phases.length - 1];
    const start = last ? addDays(last.endDate, 1) : project.startDate;
    store.savePhase({ id: uid('ph'), projectId, name: `Phase ${phases.length + 1}`, startDate: start, endDate: addDays(start, 13), order: phases.length });
  };
  const move = (i: number, d: -1 | 1) => {
    const a = phases[i], b = phases[i + d];
    if (!a || !b) return;
    store.savePhase({ ...a, order: b.order });
    store.savePhase({ ...b, order: a.order });
  };
  const del = async (ph: Phase) => {
    const n = store.data.tasks.filter((t) => t.phaseId === ph.id).length;
    const r = await confirm({ title: `Delete phase “${ph.name}”?`, message: n ? `${n} task${n > 1 ? 's' : ''} will stay in the project without a phase.` : undefined, confirmLabel: 'Delete phase', danger: true });
    if (r === 'confirm') store.deletePhase(ph.id);
  };
  return (
    <section className="card">
      <div className="card-head">
        <button className="hstack" style={{ border: 0, background: 'none', padding: 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <IChevD size={15} /> : <IChevR size={15} />}<h2>Phases</h2><span className="muted mono" style={{ fontSize: 'var(--fs-sm)' }}>({phases.length})</span>
        </button>
        <button className="btn btn-sm" onClick={add}><IPlus size={13} />Add phase</button>
      </div>
      {open && (
        <div className="card-body">
          {phases.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>No phases. Tasks can still belong to the project directly.</p>}
          {phases.map((ph, i) => (
            <div key={ph.id} className="phase-row">
              <span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{i + 1}</span>
              <input type="color" className="color-input" style={{ width: 30, height: 30 }} aria-label={`${ph.name} colour`} value={phaseColor(ph, store.data)}
                onChange={(e) => store.savePhase({ ...ph, color: e.target.value.toUpperCase() })} />
              <input className="input input-sm" style={{ width: '100%' }} aria-label="Phase name" defaultValue={ph.name}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== ph.name) store.savePhase({ ...ph, name: v }); else e.target.value = ph.name; }} />
              <input type="date" className="input input-sm ph-date" aria-label={`${ph.name} start`} value={ph.startDate}
                onChange={(e) => { if (isValidISODate(e.target.value)) store.savePhase({ ...ph, startDate: e.target.value, endDate: toEpochDay(ph.endDate) < toEpochDay(e.target.value) ? e.target.value : ph.endDate }); }} />
              <input type="date" className="input input-sm ph-date" aria-label={`${ph.name} end`} value={ph.endDate} min={ph.startDate}
                onChange={(e) => { if (isValidISODate(e.target.value) && e.target.value >= ph.startDate) store.savePhase({ ...ph, endDate: e.target.value }); }} />
              <span className="hstack" style={{ gap: 0 }}>
                <button className="icon-btn" aria-label={`Move ${ph.name} up`} disabled={i === 0} onClick={() => move(i, -1)} style={{ transform: 'rotate(180deg)' }}><IChevD size={14} /></button>
                <button className="icon-btn" aria-label={`Move ${ph.name} down`} disabled={i === phases.length - 1} onClick={() => move(i, 1)}><IChevD size={14} /></button>
                <button className="icon-btn" aria-label={`Delete ${ph.name}`} onClick={() => del(ph)}><ITrash size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectDialog({ project, onClose }: { project: Project | null; onClose(id?: string): void }) {
  const store = useStore();
  const today = store.today;
  const [d, setD] = useState<Project>(() => project ?? {
    id: uid('p'), name: '', description: '', startDate: today, targetEndDate: addDays(today, 30), status: 'planning', priority: 'medium',
    owner: '', progressMode: 'auto', manualProgress: 0, createdAt: nowISO(), updatedAt: nowISO(),
  });
  const [err, setErr] = useState<Record<string, string>>({});
  useEscape(() => onClose());
  const save = () => {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = 'Enter a project name.';
    if (!isValidISODate(d.startDate)) e.startDate = 'Enter a valid start date.';
    if (!isValidISODate(d.targetEndDate)) e.targetEndDate = 'Enter a valid target end date.';
    else if (!e.startDate && d.targetEndDate < d.startDate) e.targetEndDate = 'Target end cannot be before the start.';
    setErr(e);
    if (Object.keys(e).length) return;
    store.saveProject({ ...d, name: d.name.trim() });
    store.notify('success', project ? 'Project updated' : `Project “${d.name.trim()}” created`);
    onClose(d.id);
  };
  return (
    <div className="dialog-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="pd-title" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <h2 id="pd-title">{project ? 'Edit project' : 'New project'}</h2>
        <Field label="Project name" htmlFor="p-name" required error={err.name}>
          <input id="p-name" className="input" autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-invalid={!!err.name} />
        </Field>
        <Field label="Description" htmlFor="p-desc">
          <textarea id="p-desc" className="textarea" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </Field>
        <div className="row2">
          <Field label="Start date" htmlFor="p-start" required error={err.startDate}><input id="p-start" type="date" className="input" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} /></Field>
          <Field label="Target end date" htmlFor="p-end" required error={err.targetEndDate}><input id="p-end" type="date" className="input" value={d.targetEndDate} onChange={(e) => setD({ ...d, targetEndDate: e.target.value })} /></Field>
        </div>
        <div className="row3">
          <Field label="Status" htmlFor="p-status">
            <select id="p-status" className="select" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as ProjectStatus })}>
              {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Priority" htmlFor="p-prio">
            <select id="p-prio" className="select" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}>
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((s) => <option key={s} value={s}>{PRIORITY_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Owner" htmlFor="p-owner"><input id="p-owner" className="input" value={d.owner} onChange={(e) => setD({ ...d, owner: e.target.value })} /></Field>
        </div>
        <div className="row2">
          <Field label="Progress" htmlFor="p-pm" hint={d.progressMode === 'auto' ? 'Duration-weighted average of the project’s tasks.' : undefined}>
            <select id="p-pm" className="select" value={d.progressMode} onChange={(e) => setD({ ...d, progressMode: e.target.value as 'auto' | 'manual' })}>
              <option value="auto">Calculate from tasks</option>
              <option value="manual">Set manually</option>
            </select>
          </Field>
          {d.progressMode === 'manual' && (
            <Field label={`Manual progress: ${d.manualProgress}%`} htmlFor="p-mp"><input id="p-mp" type="range" className="range" min={0} max={100} step={5} value={d.manualProgress} onChange={(e) => setD({ ...d, manualProgress: Number(e.target.value) })} /></Field>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => onClose()}>Cancel</button>
          <button type="submit" className="btn btn-primary">{project ? 'Save project' : 'Create project'}</button>
        </div>
      </form>
    </div>
  );
}
