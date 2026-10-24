import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { emptyData } from '../src/domain/defaults';
import { ganttTasks } from '../src/domain/gantt';
import { newTask } from '../src/domain/tasks';
import { buildGanttWorkbook } from '../src/export/excel';

describe('Excel Gantt export', () => {
  const setup = () => {
    const d = emptyData();
    d.projects = [{ id: 'p1', name: 'Network refresh', description: '', startDate: '2026-10-01', targetEndDate: '2026-11-30', status: 'active', priority: 'high', owner: '', progressMode: 'auto', manualProgress: 0, createdAt: '', updatedAt: '' }];
    const work = newTask({ title: 'Install switches', startDate: '2026-10-22', endDate: '2026-10-28', categoryId: 'work', projectId: 'p1', includeInGantt: true, progress: 40, status: 'in_progress' });
    const ms = newTask({ title: 'Go-live', startDate: '2026-10-30', isMilestone: true, projectId: 'p1', includeInGantt: true, dependencyIds: [work.id] });
    const reminder = newTask({ title: 'Call mum', startDate: '2026-10-22', categoryId: 'reminder' });
    d.tasks = [work, ms, reminder];
    return { d, work, ms };
  };

  it('writes Task Register and Gantt Timeline sheets with only Gantt tasks', async () => {
    const { d, work } = setup();
    const wb = buildGanttWorkbook(d, ganttTasks(d, {}), { today: '2026-10-22', scopeLabel: 'All projects' });
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    expect(back.worksheets.map((w) => w.name)).toEqual(['Task Register', 'Gantt Timeline']);

    const reg = back.getWorksheet('Task Register')!;
    const names: string[] = [];
    for (let r = 5; r <= reg.rowCount; r++) names.push(String(reg.getCell(r, 5).value ?? ''));
    expect(names).toContain('Install switches');
    expect(names.join('|')).not.toContain('Call mum');
    const row = 5 + names.indexOf('Install switches');
    expect((reg.getCell(row, 7).value as Date).toISOString().slice(0, 10)).toBe('2026-10-22');
    expect((reg.getCell(row, 8).value as Date).toISOString().slice(0, 10)).toBe('2026-10-28');
    expect((reg.getCell(row, 9).value as any).result).toBe(7);
    expect(reg.getCell(row, 4).value).toBe(work.id);
    expect(reg.getCell(row, 11).value).toBeCloseTo(0.4);
    expect(reg.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });

    const g = back.getWorksheet('Gantt Timeline')!;
    // Classic layout: Project Start (C3) and Display Week (C4) inputs drive the date row (row 7).
    expect(g.getCell('B3').value).toBe('Project Start:');
    expect((g.getCell('C3').value as Date).toISOString().slice(0, 10)).toBe('2026-10-01'); // project start
    expect(g.getCell('C4').value).toBe(1);
    expect((g.getCell('K7').value as any).formula).toBe('$C$3-WEEKDAY($C$3,3)+($C$4-1)*7');
    expect(['WBS', 'TASK', 'PROGRESS', 'START', 'END', 'DAYS', 'AFTER'].every((h, i) => g.getCell(8, i + 1).value === h)).toBe(true);
    const dateCols = new Map<string, number>();
    g.getRow(7).eachCell((cell, col) => { const v = (cell.value as any)?.result ?? cell.value; if (v instanceof Date) dateCols.set(v.toISOString().slice(0, 10), col); });
    expect([...dateCols.keys()][0]).toBe('2026-09-28'); // Monday of the project-start week
    expect(dateCols.has('2026-10-22')).toBe(true);
    expect(dateCols.has('2026-10-28')).toBe(true);
    let taskRow = 0;
    g.eachRow((r, n) => { if (String(r.getCell(2).value).startsWith('Install switches')) taskRow = n; });
    expect(taskRow).toBeGreaterThan(8);
    const val = (c: any) => (c?.result ?? c) as Date;
    expect(val(g.getCell(taskRow, 4).value).toISOString().slice(0, 10)).toBe('2026-10-22');
    expect(val(g.getCell(taskRow, 5).value).toISOString().slice(0, 10)).toBe('2026-10-28');
    expect((g.getCell(taskRow, 5).value as any).formula).toBe(`IF($I${taskRow}="Yes",D${taskRow},D${taskRow}+F${taskRow}-1)`);
    expect(g.getCell(taskRow, 6).value).toBe(7);
    expect(g.getCell(taskRow, 3).value).toBeCloseTo(0.4);
    const cf = (g as any).conditionalFormattings as any[];
    const formulas = cf.flatMap((c) => c.rules.map((r: any) => (r.formulae ?? []).join(''))).join(' ');
    expect(formulas).toContain('TODAY()');
    expect(formulas).toContain(`"${g.getCell(taskRow, 8).value}"`); // bar rule keyed on the row's colour key
    let msRow = 0;
    g.eachRow((r, n) => { if (String(r.getCell(2).value).includes('Go-live')) msRow = n; });
    const msCell = g.getCell(msRow, dateCols.get('2026-10-30')!);
    expect((msCell.value as any).result).toBe('◆');
    // Go-live is linked to the switch install: its START is a formula on that row's END.
    expect((g.getCell(msRow, 4).value as any).formula).toBe(`MAX($E$${taskRow})+1+1`);
    expect(g.getCell(msRow, 7).value).toBe(g.getCell(taskRow, 1).value);
    // Project row rolls up from its children.
    expect((g.getCell(9, 4).value as any).formula).toMatch(/^MIN\(/);
    expect(g.views[0]).toMatchObject({ state: 'frozen', xSplit: 10, ySplit: 8 });
  });

  it('reflects changed dates on re-export and excludes tasks switched off', async () => {
    const { d, work } = setup();
    work.endDate = '2026-11-02';
    let wb = buildGanttWorkbook(d, ganttTasks(d, {}), { today: '2026-10-22', scopeLabel: 'All' });
    let reg = wb.getWorksheet('Task Register')!;
    let found = false;
    reg.eachRow((r) => { if (r.getCell(5).value === 'Install switches') { found = true; expect((r.getCell(8).value as Date).toISOString().slice(0, 10)).toBe('2026-11-02'); } });
    expect(found).toBe(true);
    work.includeInGantt = false;
    wb = buildGanttWorkbook(d, ganttTasks(d, {}), { today: '2026-10-22', scopeLabel: 'All' });
    reg = wb.getWorksheet('Task Register')!;
    reg.eachRow((r) => expect(r.getCell(5).value).not.toBe('Install switches'));
  });
});
