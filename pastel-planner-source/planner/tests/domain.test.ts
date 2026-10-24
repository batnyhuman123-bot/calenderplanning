import { describe, expect, it } from 'vitest';
import { fitLanes, layoutRow, layoutTimed } from '../src/domain/calendarLayout';
import { addDays, daysInMonth, diffDays, isLeapYear, isValidISODate, monthGrid, weekday } from '../src/domain/dates';
import { emptyData } from '../src/domain/defaults';
import { buildGanttRows, ganttTasks, timelineRange } from '../src/domain/gantt';
import {
  applyStatus, bucket, createsCycle, dependencyIssues, durationDays, matchesFilter, newTask, projectProgress, subtreeIds, validateTask, workingDays,
} from '../src/domain/tasks';
import type { PlannerData, Project, Task } from '../src/domain/types';

const T = (p: Partial<Task> & { startDate: string }) => newTask({ title: 'x', ...p });

describe('dates', () => {
  it('aligns weekdays correctly', () => {
    expect(weekday('2026-10-22')).toBe(4); // Thursday
    expect(weekday('2026-10-01')).toBe(4);
    expect(weekday('2024-02-29')).toBe(4);
    expect(weekday('2000-01-01')).toBe(6);
  });
  it('handles leap years and month lengths', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });
  it('builds an October 2026 grid starting on Sunday 27 Sep', () => {
    const g = monthGrid(2026, 9, 0);
    expect(g[0][0]).toBe('2026-09-27');
    expect(g[0][4]).toBe('2026-10-01');
    expect(g.length).toBe(5);
    expect(g[g.length - 1][6]).toBe('2026-10-31');
  });
  it('grid for Feb 2026 (starts Sunday, 28 days) is exactly 4 rows', () => {
    expect(monthGrid(2026, 1, 0).length).toBe(4);
  });
  it('Monday-start grid', () => {
    expect(monthGrid(2026, 9, 1)[0][0]).toBe('2026-09-28');
  });
  it('adds days across month/year boundaries without DST drift', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(diffDays('2026-10-22', '2026-10-28')).toBe(6);
  });
});

describe('durations', () => {
  it('counts calendar days inclusively; milestones are 0', () => {
    expect(durationDays(T({ startDate: '2026-10-22', endDate: '2026-10-28' }))).toBe(7);
    expect(durationDays(T({ startDate: '2026-10-22' }))).toBe(1);
    expect(durationDays(T({ startDate: '2026-10-22', isMilestone: true }))).toBe(0);
  });
  it('counts working days Mon–Fri', () => {
    expect(workingDays('2026-10-22', '2026-10-28')).toBe(5); // Thu..Wed
  });
});

describe('calendar layout', () => {
  const week = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
  it('keeps a multi-day task as one segment per week row', () => {
    const t = T({ startDate: '2026-10-22', endDate: '2026-10-28' });
    const r1 = layoutRow(week, [t]);
    expect(r1.segments).toHaveLength(1);
    expect(r1.segments[0]).toMatchObject({ startCol: 4, endCol: 6, continuesBefore: false, continuesAfter: true });
    const next = week.map((d) => addDays(d, 7));
    const r2 = layoutRow(next, [t]);
    expect(r2.segments[0]).toMatchObject({ startCol: 0, endCol: 3, continuesBefore: true, continuesAfter: false });
    expect(r2.segments[0].task.id).toBe(t.id);
  });
  it('stacks overlapping tasks in separate lanes and reuses free lanes', () => {
    const a = T({ startDate: '2026-10-19', endDate: '2026-10-21' });
    const b = T({ startDate: '2026-10-20', endDate: '2026-10-20' });
    const c = T({ startDate: '2026-10-23', endDate: '2026-10-23' });
    const { segments, laneCount } = layoutRow(week, [a, b, c]);
    expect(laneCount).toBe(2);
    expect(segments.find((s) => s.task.id === c.id)!.lane).toBe(0);
  });
  it('reports overflow for crowded days', () => {
    const many = Array.from({ length: 5 }, () => T({ startDate: '2026-10-20' }));
    const { segments } = layoutRow(week, many);
    const { visible, more } = fitLanes(segments, 7, 3);
    expect(visible).toHaveLength(2);
    expect(more[2]).toBe(3);
  });
  it('places overlapping timed events side by side', () => {
    const a = T({ startDate: '2026-10-22', allDay: false, startTime: '09:00', endTime: '10:00' });
    const b = T({ startDate: '2026-10-22', allDay: false, startTime: '09:30', endTime: '11:00' });
    const blocks = layoutTimed([a, b]);
    expect(blocks.map((x) => x.cols)).toEqual([2, 2]);
    expect(new Set(blocks.map((x) => x.col)).size).toBe(2);
  });
});

describe('validation & dependencies', () => {
  const data = (): PlannerData => emptyData();
  it('requires title and valid date order', () => {
    const e = validateTask(T({ title: ' ', startDate: '2026-10-22', endDate: '2026-10-20' }), data());
    expect(e.title).toBeTruthy();
    expect(e.endDate).toBeTruthy();
  });
  it('validates time ranges for timed single-day tasks', () => {
    const e = validateTask(T({ startDate: '2026-10-22', allDay: false, startTime: '10:00', endTime: '09:00' }), data());
    expect(e.endTime).toBeTruthy();
  });
  it('detects circular dependencies', () => {
    const a = T({ startDate: '2026-10-01' });
    const b = T({ startDate: '2026-10-05', dependencyIds: [a.id] });
    const c = T({ startDate: '2026-10-09', dependencyIds: [b.id] });
    const tasks = [a, b, c];
    expect(createsCycle(tasks, a.id, c.id)).toBe(true);
    expect(createsCycle(tasks, c.id, a.id)).toBe(false);
    expect(createsCycle(tasks, a.id, a.id)).toBe(true);
    const d = data();
    d.tasks = tasks;
    expect(validateTask({ ...a, dependencyIds: [c.id] }, d).dependencyIds).toMatch(/circular/);
  });
  it('warns when a successor starts before its predecessor finishes', () => {
    const a = T({ startDate: '2026-10-01', endDate: '2026-10-10' });
    const b = T({ startDate: '2026-10-08', endDate: '2026-10-12', dependencyIds: [a.id] });
    expect(dependencyIssues(b, [a, b]).map((i) => i.kind)).toContain('starts_before_finish');
    expect(dependencyIssues({ ...b, startDate: '2026-10-11' }, [a, b])).toHaveLength(0);
    expect(dependencyIssues({ ...b, startDate: '2026-10-11', status: 'in_progress' }, [a, b]).map((i) => i.kind)).toContain('predecessor_incomplete');
  });
  it('collects subtasks for cascading deletes', () => {
    const p = T({ startDate: '2026-10-01' });
    const c1 = T({ startDate: '2026-10-01', parentTaskId: p.id });
    const g1 = T({ startDate: '2026-10-01', parentTaskId: c1.id });
    expect(subtreeIds([p, c1, g1], p.id).sort()).toEqual([p.id, c1.id, g1.id].sort());
  });
});

describe('status & progress', () => {
  it('completing sets progress, completion and actual dates', () => {
    const t = applyStatus(T({ startDate: '2026-10-20' }), 'completed', '2026-10-22');
    expect(t.progress).toBe(100);
    expect(t.completedAt).toBeTruthy();
    expect(t.actualEnd).toBe('2026-10-22');
    const back = applyStatus(t, 'in_progress', '2026-10-22');
    expect(back.completedAt).toBeNull();
  });
  it('buckets tasks for today/overdue/upcoming', () => {
    const today = '2026-10-22';
    expect(bucket(T({ startDate: '2026-10-20', endDate: '2026-10-21' }), today).overdue).toBe(true);
    expect(bucket(T({ startDate: '2026-10-22' }), today).today).toBe(true);
    expect(bucket(T({ startDate: '2026-10-25' }), today).upcoming).toBe(true);
    expect(bucket({ ...T({ startDate: '2026-10-20' }), status: 'completed' }, today).overdue).toBe(false);
  });
  it('project progress is duration-weighted', () => {
    const p = { id: 'p1', progressMode: 'auto', manualProgress: 0 } as Project;
    const a = T({ startDate: '2026-10-01', endDate: '2026-10-09', projectId: 'p1', progress: 100, status: 'completed' }); // 9 days
    const b = T({ startDate: '2026-10-10', endDate: '2026-10-10', projectId: 'p1', progress: 0 }); // 1 day
    expect(projectProgress(p, [a, b])).toBe(90);
  });
  it('filters by text, category and date range', () => {
    const t = T({ startDate: '2026-10-22', endDate: '2026-10-28', title: 'Deploy Wi-Fi', categoryId: 'work' });
    expect(matchesFilter(t, { text: 'wi-fi' })).toBe(true);
    expect(matchesFilter(t, { categoryIds: ['personal'] })).toBe(false);
    expect(matchesFilter(t, { from: '2026-10-28', to: '2026-11-02' })).toBe(true);
    expect(matchesFilter(t, { from: '2026-10-29' })).toBe(false);
  });
});

describe('gantt', () => {
  it('only includes tasks flagged includeInGantt and builds hierarchy', () => {
    const d = emptyData();
    d.projects = [{ id: 'p1', name: 'Net', description: '', startDate: '2026-10-01', targetEndDate: '2026-11-30', status: 'active', priority: 'high', owner: '', progressMode: 'auto', manualProgress: 0, createdAt: '', updatedAt: '' }];
    d.phases = [{ id: 'ph1', projectId: 'p1', name: 'Build', startDate: '2026-10-01', endDate: '2026-10-31', order: 0 }];
    const a = T({ title: 'A', startDate: '2026-10-22', endDate: '2026-10-28', projectId: 'p1', phaseId: 'ph1', includeInGantt: true });
    const sub = T({ title: 'A.1', startDate: '2026-10-22', endDate: '2026-10-23', projectId: 'p1', phaseId: 'ph1', parentTaskId: a.id, includeInGantt: true });
    const personal = T({ title: 'Dentist', startDate: '2026-10-22', categoryId: 'personal' });
    d.tasks = [a, sub, personal];
    const tasks = ganttTasks(d, {});
    expect(tasks.map((t) => t.title)).toEqual(['A', 'A.1']);
    const rows = buildGanttRows(d, tasks, '2026-10-22');
    expect(rows.map((r) => [r.kind, r.depth, r.wbs])).toEqual([['project', 0, '1'], ['phase', 1, '1.1'], ['task', 2, '1.1.1'], ['task', 3, '1.1.1.1']]);
    expect(rows[0].start).toBe('2026-10-22');
    expect(rows[0].end).toBe('2026-10-28');
    const collapsed = buildGanttRows(d, tasks, '2026-10-22', new Set(['ph:ph1']));
    expect(collapsed).toHaveLength(2);
  });
  it('timeline range snaps to whole weeks for week zoom', () => {
    const r = timelineRange([{ start: '2026-10-22', end: '2026-10-28' }], 'week', '2026-10-22');
    expect(weekday(r.start)).toBe(1);
    expect(r.days % 7).toBe(0);
  });
});
