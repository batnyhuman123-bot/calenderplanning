import { describe, expect, it } from 'vitest';
import { autoSchedule, fitPhases, shiftWithSubtasks } from '../src/domain/schedule';
import { newTask } from '../src/domain/tasks';
import type { Phase, Task } from '../src/domain/types';

const T = (p: Partial<Task> & { startDate: string }) => newTask({ title: 'x', ...p });
const byId = (ts: Task[], id: string) => ts.find((t) => t.id === id)!;

describe('linked auto-scheduling', () => {
  const chain = () => {
    const a = T({ title: 'A', startDate: '2026-10-01', endDate: '2026-10-05' });
    const b = T({ title: 'B', startDate: '2026-10-06', endDate: '2026-10-08', dependencyIds: [a.id] });
    const c = T({ title: 'C', startDate: '2026-10-12', endDate: '2026-10-12', dependencyIds: [b.id] }); // 3-day gap
    return { a, b, c };
  };

  it('moves every downstream task when a prerequisite is extended', () => {
    const { a, b, c } = chain();
    const first = autoSchedule([a, b, c]).tasks; // adopt existing gaps
    const longer = first.map((t) => (t.id === a.id ? { ...t, endDate: '2026-10-09' } : t));
    const res = autoSchedule(longer, a.id);
    expect(byId(res.tasks, b.id)).toMatchObject({ startDate: '2026-10-10', endDate: '2026-10-12' });
    expect(byId(res.tasks, c.id)).toMatchObject({ startDate: '2026-10-16', endDate: '2026-10-16' }); // keeps its 3-day gap
    expect(res.changed.map((t) => t.title).sort()).toEqual(['B', 'C']);
  });

  it('pulls tasks earlier when a prerequisite finishes sooner', () => {
    const { a, b, c } = chain();
    const res = autoSchedule([{ ...a, endDate: '2026-10-02' }, b, c], a.id, { previous: [a, b, c] });
    expect(byId(res.tasks, b.id).startDate).toBe('2026-10-03');
  });

  it('a manually moved dependent task keeps its new gap', () => {
    const { a, b, c } = chain();
    const res = autoSchedule([a, { ...b, startDate: '2026-10-08', endDate: '2026-10-10' }, c], b.id, { previous: [a, b, c] });
    expect(byId(res.tasks, b.id).lagDays).toBe(2);
    expect(byId(res.tasks, c.id).startDate).toBe('2026-10-14');
  });

  it('newly linked tasks snap after the prerequisite', () => {
    const a = T({ startDate: '2026-10-01', endDate: '2026-10-05' });
    const b = T({ startDate: '2026-10-02', endDate: '2026-10-03', dependencyIds: [a.id] });
    const res = autoSchedule([a, b], b.id, { relinked: true });
    expect(byId(res.tasks, b.id)).toMatchObject({ startDate: '2026-10-06', endDate: '2026-10-07', lagDays: 0 });
  });

  it('summary tasks span and average their subtasks', () => {
    const p = T({ startDate: '2026-10-01', endDate: '2026-10-01' });
    const k1 = T({ startDate: '2026-10-02', endDate: '2026-10-03', parentTaskId: p.id, progress: 100, status: 'completed' });
    const k2 = T({ startDate: '2026-10-04', endDate: '2026-10-05', parentTaskId: p.id, progress: 0 });
    const res = autoSchedule([p, k1, k2]);
    expect(byId(res.tasks, p.id)).toMatchObject({ startDate: '2026-10-02', endDate: '2026-10-05', progress: 50 });
  });

  it('pushing a summary task carries its subtasks', () => {
    const a = T({ startDate: '2026-10-01', endDate: '2026-10-05' });
    const p = T({ startDate: '2026-10-06', endDate: '2026-10-09', dependencyIds: [a.id] });
    const k = T({ startDate: '2026-10-06', endDate: '2026-10-09', parentTaskId: p.id });
    const first = autoSchedule([a, p, k]).tasks;
    const res = autoSchedule(first.map((t) => (t.id === a.id ? { ...t, endDate: '2026-10-07' } : t)), a.id);
    expect(byId(res.tasks, k.id).startDate).toBe('2026-10-08');
    expect(byId(res.tasks, p.id).startDate).toBe('2026-10-08');
  });

  it('shiftWithSubtasks moves a whole branch', () => {
    const p = T({ startDate: '2026-10-01', endDate: '2026-10-02' });
    const k = T({ startDate: '2026-10-01', endDate: '2026-10-02', parentTaskId: p.id });
    const out = shiftWithSubtasks([p, k], p.id, 3);
    expect(out.map((t) => t.startDate)).toEqual(['2026-10-04', '2026-10-04']);
  });

  it('phases stretch to fit their tasks', () => {
    const ph: Phase = { id: 'ph', projectId: 'p', name: 'Build', startDate: '2026-10-01', endDate: '2026-10-05', order: 0 };
    const t = T({ startDate: '2026-10-03', endDate: '2026-10-12', phaseId: 'ph' });
    expect(fitPhases([ph], [t])[0]).toMatchObject({ startDate: '2026-10-03', endDate: '2026-10-12' });
  });
});
