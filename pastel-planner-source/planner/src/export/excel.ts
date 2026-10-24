import ExcelJS from 'exceljs';
import { argb, deepFor, fillFor, inkFor, strokeFor } from '../domain/colors';
import { addDays, fmtDate, parts, startOfWeek, toEpochDay, weekday } from '../domain/dates';
import { barColor, buildGanttRows, phaseColor, type GanttRow } from '../domain/gantt';
import { durationDays, isOverdue, workingDays } from '../domain/tasks';
import type { ISODate, PlannerData, Task } from '../domain/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../domain/types';

/**
 * Builds a genuine, editable .xlsx workbook from the Gantt-eligible tasks.
 *
 *  Sheet 1 "Task Register" – one row per task, typed date cells, filters,
 *          frozen header, data bars for progress, status highlighting.
 *  Sheet 2 "Gantt Timeline" – hierarchy on the left, a date grid on the
 *          right. Bars are drawn with CONDITIONAL FORMATTING driven by each
 *          row's Start/End/% cells, so if you edit dates in Excel the bars
 *          move with them.
 *
 * Duration rule (documented in the workbook): calendar days, inclusive,
 * Duration = End − Start + 1; milestones = 0. Working days = Mon–Fri
 * (NETWORKDAYS, no holiday list).
 */

export interface ExportOptions {
  today: ISODate;
  scopeLabel: string;
  /** Force the timeline scale; default picks daily up to 180 days, weekly beyond. */
  scale?: 'day' | 'week';
}

const xlDate = (iso: ISODate) => new Date(Date.UTC(parts(iso).year, parts(iso).month, parts(iso).day));
const q = (s: string) => s.replace(/"/g, '""');

const INK = 'FF2F2A35';
const MUTED = 'FF8A8390';
const LINE = 'FFECE7E3';
const HEAD_BG = argb('#E9DDF9');
const HEAD_INK = 'FF4A3578';

const solid = (c: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c }, bgColor: { argb: c } });
const thinBottom: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: LINE } } };

export function buildGanttWorkbook(data: PlannerData, tasks: Task[], opts: ExportOptions): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true; // linked formulas recalculate when opened
  wb.creator = 'Pastel Planner';
  wb.created = new Date();
  wb.title = `Gantt – ${opts.scopeLabel}`;

  const rows = buildGanttRows(data, tasks, opts.today);
  const wbsById = new Map(rows.filter((r) => r.task).map((r) => [r.task!.id, r.wbs]));
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Other';
  const catOf = (id: string) => data.categories.find((c) => c.id === id) ?? data.categories[data.categories.length - 1];
  const projName = (id: string | null) => (id ? data.projects.find((p) => p.id === id)?.name ?? '' : '(No project)');
  const phaseName = (id: string | null) => (id ? data.phases.find((p) => p.id === id)?.name ?? '' : '');
  const exportedAt = new Date();

  /* ======================= Sheet 1: Task Register ======================= */
  const reg = wb.addWorksheet('Task Register', { views: [{ state: 'frozen', ySplit: 4, xSplit: 0, showGridLines: false }], properties: { tabColor: { argb: argb('#D9E8FC') } } });
  const cols: { header: string; key: string; width: number }[] = [
    { header: 'Project', key: 'project', width: 26 },
    { header: 'Phase', key: 'phase', width: 20 },
    { header: 'WBS', key: 'wbs', width: 8 },
    { header: 'Task ID', key: 'id', width: 20 },
    { header: 'Task name', key: 'name', width: 38 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Start date', key: 'start', width: 13 },
    { header: 'End date', key: 'end', width: 13 },
    { header: 'Duration (days)', key: 'dur', width: 11 },
    { header: 'Working days', key: 'wd', width: 10 },
    { header: 'Progress', key: 'prog', width: 11 },
    { header: 'Status', key: 'status', width: 13 },
    { header: 'Schedule', key: 'sched', width: 11 },
    { header: 'Priority', key: 'prio', width: 10 },
    { header: 'Dependencies (finish-to-start)', key: 'deps', width: 36 },
    { header: 'Milestone', key: 'ms', width: 10 },
    { header: 'Baseline start', key: 'bs', width: 13 },
    { header: 'Baseline end', key: 'be', width: 13 },
    { header: 'Actual start', key: 'as', width: 13 },
    { header: 'Actual finish', key: 'ae', width: 13 },
  ];
  reg.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  reg.mergeCells(1, 1, 1, 8);
  const t1 = reg.getCell(1, 1);
  t1.value = `Task Register — ${opts.scopeLabel}`;
  t1.font = { size: 15, bold: true, color: { argb: INK } };
  reg.getRow(1).height = 24;
  reg.mergeCells(2, 1, 2, 12);
  reg.getCell(2, 1).value = `Exported ${exportedAt.toLocaleString()} · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · Duration = calendar days, inclusive (End − Start + 1); milestones = 0 · Working days = Mon–Fri. This file is a snapshot and does not update with the planner.`;
  reg.getCell(2, 1).font = { size: 9, color: { argb: MUTED }, italic: true };
  const header = reg.getRow(4);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: HEAD_INK }, size: 10 };
    cell.fill = solid(HEAD_BG);
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: argb('#A08BD0') } } };
  });
  header.height = 30;

  const taskRows = rows.filter((r) => r.task);
  let rIdx = 5;
  for (const r of taskRows) {
    const t = r.task!;
    const row = reg.getRow(rIdx);
    const depLabels = t.dependencyIds.map((id) => {
      const p = data.tasks.find((x) => x.id === id);
      if (!p) return null;
      return wbsById.has(id) ? `${wbsById.get(id)} ${p.title}` : `${p.title} (not in export)`;
    }).filter(Boolean).join('; ');
    const overdue = isOverdue(t, opts.today);
    row.values = {
      project: projName(t.projectId), phase: phaseName(t.phaseId), wbs: r.wbs, id: t.id,
      name: t.title, category: catName(t.categoryId),
      start: xlDate(t.startDate), end: xlDate(t.endDate),
      dur: { formula: `IF(P${rIdx}="Yes",0,H${rIdx}-G${rIdx}+1)`, result: durationDays(t) } as any,
      wd: { formula: `IF(P${rIdx}="Yes",0,NETWORKDAYS(G${rIdx},H${rIdx}))`, result: t.isMilestone ? 0 : workingDays(t.startDate, t.endDate) } as any,
      prog: (t.status === 'completed' ? 100 : t.progress) / 100,
      status: STATUS_LABEL[t.status],
      sched: t.status === 'completed' ? 'Done' : overdue ? 'Overdue' : 'On track',
      prio: PRIORITY_LABEL[t.priority], deps: depLabels, ms: t.isMilestone ? 'Yes' : 'No',
      bs: t.baselineStart ? xlDate(t.baselineStart) : null, be: t.baselineEnd ? xlDate(t.baselineEnd) : null,
      as: t.actualStart ? xlDate(t.actualStart) : null, ae: t.actualEnd ? xlDate(t.actualEnd) : null,
    };
    row.getCell('name').alignment = { indent: Math.max(0, r.depth - 1) };
    for (const k of ['start', 'end', 'bs', 'be', 'as', 'ae']) row.getCell(k).numFmt = 'dd-mmm-yyyy';
    row.getCell('prog').numFmt = '0%';
    const c = catOf(t.categoryId);
    row.getCell('category').fill = solid(argb(c.color));
    row.getCell('category').font = { color: { argb: argb(inkFor(c.color)) }, bold: true, size: 10 };
    if (t.isMilestone) {
      row.getCell('ms').fill = solid(argb(data.settings.milestoneColor));
      row.getCell('name').value = `◆ ${t.title}`;
    }
    row.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= cols.length) { cell.border = thinBottom; if (!cell.font) cell.font = { size: 10, color: { argb: INK } }; } });
    row.height = 18;
    rIdx++;
  }
  const lastReg = Math.max(5, rIdx - 1);
  reg.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastReg, column: cols.length } };
  if (taskRows.length) {
    reg.addConditionalFormatting({
      ref: `K5:K${lastReg}`,
      rules: [{ type: 'dataBar', priority: 1, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: argb('#A08BD0') } } as any],
    });
    reg.addConditionalFormatting({
      ref: `L5:M${lastReg}`,
      rules: [
        { type: 'containsText', operator: 'containsText', text: 'Blocked', priority: 2, style: { font: { color: { argb: 'FFB0413E' }, bold: true }, fill: solid('FFFBE7E4') } } as any,
        { type: 'containsText', operator: 'containsText', text: 'Overdue', priority: 3, style: { font: { color: { argb: argb('#8F3E28') }, bold: true }, fill: solid(argb('#F8D9CF')) } } as any,
        { type: 'containsText', operator: 'containsText', text: 'Completed', priority: 4, style: { font: { color: { argb: argb('#2C6A4D') } }, fill: solid(argb('#D8EFE4')) } } as any,
        { type: 'containsText', operator: 'containsText', text: 'Done', priority: 5, style: { font: { color: { argb: argb('#2C6A4D') } }, fill: solid(argb('#D8EFE4')) } } as any,
      ],
    });
    (reg as any).dataValidations.add(`L5:L${lastReg}`, { type: 'list', allowBlank: false, formulae: [`"${Object.values(STATUS_LABEL).join(',')}"`] });
    (reg as any).dataValidations.add(`K5:K${lastReg}`, { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1], showErrorMessage: true, errorTitle: 'Progress', error: 'Enter a percentage between 0% and 100%.' });
  } else {
    reg.getCell(5, 1).value = 'No tasks are included in the Gantt chart for this selection.';
    reg.getCell(5, 1).font = { italic: true, color: { argb: MUTED } };
  }

  /* ======================= Sheet 2: Gantt Timeline ======================= */
  /*
   * Classic Excel Gantt layout (as in the popular conditional-formatting
   * tutorials): Project Start + Display Week inputs drive a daily timeline
   * grouped under weekly date headers; TASK / PROGRESS / START / END / DAYS
   * on the left; phase bands in their own colours; bars, progress, weekends
   * and today's column are all conditional formatting, so the sheet stays
   * live when dates or inputs are edited.
   */
  const g = wb.addWorksheet('Gantt Timeline', { properties: { tabColor: { argb: argb('#E9DDF9') } } });
  const LEFT = 10; // A WBS, B Task, C Progress, D Start, E End, F Days, G After (predecessors), H colour key (hidden), I milestone (hidden), J spacer
  const firstTL = LEFT + 1; // K
  const HDR_WEEK = 6, HDR_DAY = 7, HDR_HEAD = 8, FIRST = 9;
  const ds = rows.flatMap((r) => [r.start, r.end]).sort();
  const scopeProject = tasks.length && tasks.every((t) => t.projectId && t.projectId === tasks[0].projectId) ? data.projects.find((p) => p.id === tasks[0].projectId) : undefined;
  const projectStart: ISODate = scopeProject?.startDate && (!ds.length || scopeProject.startDate <= ds[0]) ? scopeProject.startDate : ds[0] ?? opts.today;
  const lastDate = ds.length ? ds[ds.length - 1] : addDays(opts.today, 27);
  const tlStart = startOfWeek(projectStart, 1); // Excel: =Project_Start-WEEKDAY(Project_Start,3)
  const weeks = Math.max(8, Math.ceil((toEpochDay(lastDate) - toEpochDay(tlStart) + 1) / 7) + 1);
  const nCols = weeks * 7;
  const lastTL = firstTL + nCols - 1;
  const colL = (n: number) => g.getColumn(n).letter;
  const J = colL(firstTL);
  const colDate = (i: number) => addDays(tlStart, i);

  g.views = [{ state: 'frozen', xSplit: LEFT, ySplit: HDR_HEAD, showGridLines: false, zoomScale: 90 }];
  [6, 40, 14, 15, 15, 7, 10, 4, 4, 2].forEach((w, i) => (g.getColumn(i + 1).width = w));
  g.getColumn(8).hidden = true;
  g.getColumn(9).hidden = true;
  for (let c = firstTL; c <= lastTL; c++) g.getColumn(c).width = 2.7;

  // Title block
  g.getCell('A1').value = scopeProject ? scopeProject.name : `Gantt Chart — ${opts.scopeLabel}`;
  g.getCell('A1').font = { size: 20, bold: true, color: { argb: INK } };
  g.getRow(1).height = 30;
  g.getCell('A2').value = [scopeProject?.owner ? `Project lead: ${scopeProject.owner}` : null, opts.scopeLabel, `Exported ${fmtDate(opts.today)}`].filter(Boolean).join('  ·  ');
  g.getCell('A2').font = { size: 10, color: { argb: MUTED } };
  const label = (cell: string, text: string) => {
    g.getCell(cell).value = text;
    g.getCell(cell).font = { bold: true, size: 10, color: { argb: INK } };
    g.getCell(cell).alignment = { horizontal: 'right', vertical: 'middle' };
  };
  const input = (cell: string) => {
    const c = g.getCell(cell);
    c.fill = solid(argb('#FFF7E6'));
    c.border = { top: { style: 'thin', color: { argb: argb('#E6C98F') } }, bottom: { style: 'thin', color: { argb: argb('#E6C98F') } }, left: { style: 'thin', color: { argb: argb('#E6C98F') } }, right: { style: 'thin', color: { argb: argb('#E6C98F') } } };
    c.font = { bold: true, size: 11, color: { argb: argb('#7A5512') } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  };
  label('B3', 'Project Start:');
  g.mergeCells('C3:D3');
  g.getCell('C3').value = xlDate(projectStart);
  g.getCell('C3').numFmt = 'ddd d mmm yyyy';
  input('C3');
  label('B4', 'Display Week:');
  g.getCell('C4').value = 1;
  input('C4');
  (g as any).dataValidations.add('C4', { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: false, formulae: [1], showErrorMessage: true, errorTitle: 'Display Week', error: 'Enter a week number of 1 or more.' });
  (g as any).dataValidations.add('C3', { type: 'date', operator: 'greaterThan', allowBlank: false, formulae: [new Date(Date.UTC(1990, 0, 1))], showErrorMessage: true, errorTitle: 'Project Start', error: 'Enter a valid date.' });
  g.mergeCells('E3:G4');
  g.getCell('E3').value = 'Change these to move the timeline. Edit a task’s START or DAYS and every linked task after it moves too.';
  g.getCell('E3').font = { italic: true, size: 9, color: { argb: MUTED } };
  g.getCell('E3').alignment = { wrapText: true, vertical: 'middle' };
  g.getRow(3).height = 20;
  g.getRow(4).height = 20;

  // Legend (row 4, timeline area)
  const legendItems: [string, string][] = [];
  const keyColor = new Map<string, { bg: string; fill: string; summary: boolean }>();
  const rowKey = (r: GanttRow) => {
    if (r.kind === 'project') return 'PRJ';
    if (r.kind === 'phase') return `PH_${r.phase!.id}`;
    return `C_${barColor(r.task!, data).replace('#', '').toUpperCase()}`;
  };
  for (const r of rows) {
    const k = rowKey(r);
    if (keyColor.has(k)) continue;
    if (r.kind === 'project') keyColor.set(k, { bg: '#CFC6E6', fill: '#9D8DC9', summary: true });
    else if (r.kind === 'phase') {
      const pc = phaseColor(r.phase!, data);
      keyColor.set(k, { bg: strokeFor(pc), fill: deepFor(pc), summary: true });
      if (data.settings.ganttColorBy === 'phase') legendItems.push([r.phase!.name, pc]);
    } else {
      const c = barColor(r.task!, data);
      keyColor.set(k, { bg: c, fill: fillFor(c), summary: false });
    }
  }
  if (data.settings.ganttColorBy === 'category') {
    for (const c of [...new Set(tasks.map((t) => t.categoryId))].map(catOf)) legendItems.push([c.name, c.color]);
  }
  legendItems.push(['Milestone ◆', data.settings.milestoneColor], ['Completed', data.settings.completedColor], ['Today', '#F3D9E2']);
  let lcol = firstTL;
  for (const [name, bg] of legendItems) {
    const span = Math.max(5, Math.ceil(name.length / 1.9));
    if (lcol + span - 1 > lastTL) break;
    g.mergeCells(4, lcol, 4, lcol + span - 1);
    const cell = g.getCell(4, lcol);
    cell.value = name;
    cell.fill = solid(argb(bg));
    cell.font = { size: 9, bold: true, color: { argb: argb(name === 'Today' ? '#A8506F' : inkFor(bg)) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    lcol += span + 1;
  }

  // Timeline headers: week date (merged ×7), day number, weekday initial.
  const dateRef = (col: number) => `${colL(col)}$${HDR_DAY}`;
  for (let i = 0; i < nCols; i++) {
    const col = firstTL + i;
    const d = colDate(i);
    const day = g.getCell(HDR_DAY, col);
    day.value = i === 0
      ? ({ formula: '$C$3-WEEKDAY($C$3,3)+($C$4-1)*7', result: xlDate(d) } as any)
      : ({ formula: `${colL(col - 1)}${HDR_DAY}+1`, result: xlDate(d) } as any);
    day.numFmt = 'd';
    day.font = { size: 9, color: { argb: INK } };
    day.alignment = { horizontal: 'center', vertical: 'middle' };
    day.border = { left: i % 7 === 0 ? { style: 'thin', color: { argb: argb('#C9BEE3') } } : undefined };
    const letter = g.getCell(HDR_HEAD, col);
    letter.value = { formula: `LEFT(TEXT(${colL(col)}${HDR_DAY},"ddd"),1)`, result: 'SMTWTFS'[weekday(d)] } as any;
    letter.font = { size: 8, bold: true, color: { argb: HEAD_INK } };
    letter.fill = solid(HEAD_BG);
    letter.alignment = { horizontal: 'center', vertical: 'middle' };
    letter.border = { bottom: { style: 'thin', color: { argb: argb('#A08BD0') } }, left: i % 7 === 0 ? { style: 'thin', color: { argb: argb('#C9BEE3') } } : undefined };
    if (i % 7 === 0) {
      g.mergeCells(HDR_WEEK, col, HDR_WEEK, col + 6);
      const wk = g.getCell(HDR_WEEK, col);
      wk.value = { formula: `${colL(col)}${HDR_DAY}`, result: xlDate(d) } as any;
      wk.numFmt = 'd mmm yyyy';
      wk.font = { size: 9, bold: true, color: { argb: HEAD_INK } };
      wk.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      wk.fill = solid('FFFBF9FD');
      wk.border = { left: { style: 'thin', color: { argb: argb('#C9BEE3') } } };
    }
  }
  g.getRow(HDR_WEEK).height = 18;
  g.getRow(HDR_DAY).height = 16;
  g.getRow(HDR_HEAD).height = 22;
  ['WBS', 'TASK', 'PROGRESS', 'START', 'END', 'DAYS', 'AFTER', 'KEY', 'MS', ''].forEach((h, i) => {
    const cell = g.getCell(HDR_HEAD, i + 1);
    cell.value = h || null;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(argb('#6B58A8'));
    cell.alignment = { vertical: 'middle', horizontal: i === 1 ? 'left' : 'center', indent: i === 1 ? 1 : 0 };
  });

  // ---- Linking: every date on this sheet is a formula tied to the rows it depends on ----
  const rowNo = new Map(rows.map((r, i) => [r.key, FIRST + i]));
  const kids = new Map<number, number[]>(); // row index -> child row indexes
  const stack: number[] = [];
  rows.forEach((r, i) => {
    while (stack.length && rows[stack[stack.length - 1]].depth >= r.depth) stack.pop();
    if (stack.length) { const p = stack[stack.length - 1]; if (!kids.has(p)) kids.set(p, []); kids.get(p)!.push(i); }
    stack.push(i);
  });
  const leavesOf = (i: number): number[] => (kids.get(i)?.length ? kids.get(i)!.flatMap(leavesOf) : [i]);
  const parentIdx = new Map<number, number>();
  kids.forEach((cs, p) => cs.forEach((c) => parentIdx.set(c, p)));
  const xlDateConst = (iso: ISODate) => { const p = parts(iso); return `DATE(${p.year},${p.month + 1},${p.day})`; };
  const anchorCache = new Map<number, string | null>();
  /** Formula for a task's start driven by its prerequisites (or by its parent's), or null if it is free. */
  const anchor = (i: number): string | null => {
    if (anchorCache.has(i)) return anchorCache.get(i)!;
    const r = rows[i];
    let out: string | null = null;
    const t = r.task;
    if (t) {
      const preds = t.dependencyIds.map((id) => data.tasks.find((x) => x.id === id)).filter(Boolean) as Task[];
      if (preds.length) {
        const latest = preds.map((p) => p.endDate).sort().pop()!;
        const lag = toEpochDay(t.startDate) - (toEpochDay(latest) + 1);
        const refs = preds.map((p) => (rowNo.has(p.id) ? `$E$${rowNo.get(p.id)}` : xlDateConst(p.endDate)));
        out = `MAX(${refs.join(',')})+1${lag ? (lag > 0 ? `+${lag}` : `${lag}`) : ''}`;
      } else {
        const pi = parentIdx.get(i);
        const parent = pi !== undefined ? rows[pi] : undefined;
        const pa = parent?.task ? anchor(pi!) : null;
        if (pa && parent?.task) {
          const off = toEpochDay(t.startDate) - toEpochDay(parent.task.startDate);
          out = `(${pa})${off ? (off > 0 ? `+${off}` : `${off}`) : ''}`;
        }
      }
    }
    anchorCache.set(i, out);
    return out;
  };
  const wbsOf = new Map(rows.filter((r) => r.task).map((r) => [r.task!.id, r.wbs]));

  // Body
  rows.forEach((r: GanttRow, i) => {
    const n = FIRST + i;
    const row = g.getRow(n);
    const t = r.task;
    const isSum = !t;
    const key = rowKey(r);
    row.getCell(1).value = r.wbs;
    row.getCell(2).value = t?.isMilestone ? `◆ ${r.label}` : r.kind === 'phase' ? r.label.toUpperCase() : r.label;
    row.getCell(2).alignment = { indent: Math.max(0, r.depth - 1) + (t ? 1 : 0), vertical: 'middle' };
    const children = kids.get(i) ?? [];
    const days = t ? durationDays(t) : toEpochDay(r.end) - toEpochDay(r.start) + 1;
    if (children.length) {
      // Summary row (project, phase or parent task): spans and averages its children.
      const cRows = children.map((c) => FIRST + c);
      const leafRows = leavesOf(i).map((c) => FIRST + c);
      row.getCell(4).value = { formula: `MIN(${cRows.map((c) => `D${c}`).join(',')})`, result: xlDate(r.start) } as any;
      row.getCell(5).value = { formula: `MAX(${cRows.map((c) => `E${c}`).join(',')})`, result: xlDate(r.end) } as any;
      row.getCell(6).value = { formula: `E${n}-D${n}+1`, result: days } as any;
      const prog = `IFERROR((${leafRows.map((c) => `C${c}*MAX(1,F${c})`).join('+')})/(${leafRows.map((c) => `MAX(1,F${c})`).join('+')}),0)`;
      row.getCell(3).value = prog.length < 7000 ? ({ formula: prog, result: r.progress / 100 } as any) : r.progress / 100;
    } else {
      const a = anchor(i);
      row.getCell(4).value = a ? ({ formula: a, result: xlDate(r.start) } as any) : xlDate(r.start);
      row.getCell(5).value = { formula: `IF($I${n}="Yes",D${n},D${n}+F${n}-1)`, result: xlDate(r.end) } as any;
      row.getCell(6).value = days;
      row.getCell(3).value = r.progress / 100;
      if (!a) row.getCell(4).font = { size: 10, color: { argb: INK } };
    }
    row.getCell(3).numFmt = '0%';
    row.getCell(4).numFmt = 'ddd d/mm/yy';
    row.getCell(5).numFmt = 'ddd d/mm/yy';
    row.getCell(7).value = t ? t.dependencyIds.map((id) => wbsOf.get(id) ?? data.tasks.find((x) => x.id === id)?.title).filter(Boolean).join(', ') || null : null;
    row.getCell(8).value = key;
    row.getCell(9).value = t?.isMilestone ? 'Yes' : 'No';
    const band = r.kind === 'project' ? argb('#EDE6F8') : r.kind === 'phase' ? argb(data.settings.ganttColorBy === 'phase' ? phaseColor(r.phase!, data) : '#F5F0FC') : 'FFFFFFFF';
    for (let c = 1; c <= LEFT; c++) {
      const cell = row.getCell(c);
      cell.font = { size: r.kind === 'project' ? 11 : 10, bold: isSum, color: { argb: c === 1 ? MUTED : INK } };
      if (c !== 2) cell.alignment = { vertical: 'middle', horizontal: c >= 3 ? 'center' : 'left' };
      if (c < LEFT) cell.fill = solid(band);
      cell.border = { bottom: { style: 'thin', color: { argb: isSum ? argb('#D9CFEE') : LINE } } };
    }
    if (!children.length && anchor(i)) {
      // Linked start: shown in purple italics so it reads as calculated, not typed.
      row.getCell(4).font = { size: 10, italic: true, color: { argb: HEAD_INK } };
      row.getCell(4).note = 'Calculated: starts after the task(s) in AFTER. Change their dates and this follows.';
    }
    if (t && !children.length) row.getCell(7).font = { size: 9, color: { argb: MUTED } };
    if (t && (r.state === 'overdue' || r.state === 'blocked' || r.state === 'completed')) {
      row.getCell(2).value = `${row.getCell(2).value}  (${r.state === 'overdue' ? 'Overdue' : r.state === 'blocked' ? 'Blocked' : '✓ Done'})`;
    }
    for (let k = 0; k < nCols; k++) {
      const col = firstTL + k;
      const cell = row.getCell(col);
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } }, left: k % 7 === 0 ? { style: 'hair', color: { argb: argb('#E2DAF0') } } : undefined };
      if (t?.isMilestone) {
        const hit = colDate(k) === t.startDate;
        cell.value = { formula: `IF(AND($I${n}="Yes",${dateRef(col)}=$D${n}),"◆","")`, result: hit ? '◆' : '' } as any;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = { size: 11, bold: true, color: { argb: argb('#B07A1E') } };
      }
    }
    row.height = r.kind === 'project' ? 22 : 20;
  });

  if (rows.length) (g as any).dataValidations.add(`F${FIRST}:F${FIRST + rows.length - 1}`, { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Days', error: 'Enter the number of calendar days (0 for a milestone).' });
  if (rows.length) {
    const lastRow = FIRST + rows.length - 1;
    const ref = `${J}${FIRST}:${colL(lastTL)}${lastRow}`;
    const D = `${J}$${HDR_DAY}`;
    const on = `${D}>=$D${FIRST},${D}<=$E${FIRST}`;
    const done = `${D}<$D${FIRST}+ROUND(($E${FIRST}-$D${FIRST}+1)*$C${FIRST},0)`;
    let priority = 1;
    const rules: any[] = [];
    rules.push({ type: 'expression', priority: priority++, formulae: [`AND($I${FIRST}="Yes",${D}=$D${FIRST})`], style: { fill: solid(argb(data.settings.milestoneColor)) } });
    rules.push({ type: 'expression', priority: priority++, formulae: [`AND(LEFT($H${FIRST},2)="C_",$C${FIRST}>=1,${on})`], style: { fill: solid(argb(strokeFor(data.settings.completedColor))) } });
    for (const [k, v] of keyColor) {
      rules.push({ type: 'expression', priority: priority++, formulae: [`AND($H${FIRST}="${q(k)}",${on},${done})`], style: { fill: solid(argb(v.fill)) } });
      rules.push({ type: 'expression', priority: priority++, formulae: [`AND($H${FIRST}="${q(k)}",${on})`], style: { fill: solid(argb(v.bg)) } });
    }
    rules.push({ type: 'expression', priority: priority++, formulae: [`${D}=TODAY()`], style: { fill: solid(argb('#F7E3EA')), border: { left: { style: 'thin', color: { argb: argb('#A8506F') } }, right: { style: 'thin', color: { argb: argb('#A8506F') } } } } });
    rules.push({ type: 'expression', priority: priority++, formulae: [`WEEKDAY(${D},2)>5`], style: { fill: solid('FFF7F5F3') } });
    g.addConditionalFormatting({ ref, rules });
    g.addConditionalFormatting({
      ref: `C${FIRST}:C${lastRow}`,
      rules: [{ type: 'dataBar', priority: priority++, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: argb('#A08BD0') } } as any],
    });
    // Header: highlight today's day number and weekday letter.
    g.addConditionalFormatting({
      ref: `${J}${HDR_DAY}:${colL(lastTL)}${HDR_HEAD}`,
      rules: [{ type: 'expression', priority: priority++, formulae: [`${J}$${HDR_DAY}=TODAY()`], style: { fill: solid(argb('#A8506F')), font: { bold: true, color: { argb: 'FFFFFFFF' } } } } as any],
    });
  } else {
    g.getCell(FIRST, 2).value = 'No tasks are included in the Gantt chart for this selection.';
    g.getCell(FIRST, 2).font = { italic: true, color: { argb: MUTED } };
  }
  g.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HDR_WEEK}:${HDR_HEAD}` };
  reg.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' };
  return wb;
}

export async function exportGanttXlsx(data: PlannerData, tasks: Task[], opts: ExportOptions): Promise<Blob> {
  const wb = buildGanttWorkbook(data, tasks, opts);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
