// End-to-end acceptance run against the built single-file app (browser storage mode).
// Usage: npm run build && node tests/e2e/acceptance.mjs
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'dist/index.html'));
const server = createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }).listen(4517);
const shots = process.env.SHOTS || join(root, 'tests/e2e/out');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4517/');
check('Planner starts empty (no example tasks)', await page.locator('.month .bar').count() === 0);
await page.getByRole('button', { name: 'Start planning' }).click();

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const Y = now.getFullYear(), M = now.getMonth();
const iso = (d) => `${Y}-${pad(M + 1)}-${pad(d)}`;
const D1 = iso(22), D2 = iso(28), D3 = iso(30);

async function fillTask({ date, title, category, end, project, gantt }) {
  await page.locator(`[data-date="${date}"]`).click({ position: { x: 60, y: 90 } });
  await page.getByLabel('Title').fill(title);
  await page.getByRole('radio', { name: category }).click();
  if (end) await page.locator('#f-end').fill(end);
  if (project) {
    await page.getByRole('radio', { name: /Part of a project/ }).click();
    await page.locator('#f-proj').selectOption({ label: project });
  }
  if (gantt) await page.locator('label[for="f-gantt"]').click();
  await page.getByRole('button', { name: 'Save task' }).click();
}

// --- Scenario: create a project first
await page.getByRole('button', { name: 'Gantt Charts' }).first().click();
check('Gantt Charts welcome shown when empty', await page.getByText('Plan a project as a Gantt chart').isVisible());
await page.getByRole('button', { name: 'New Gantt Chart' }).first().click();
await page.getByLabel('Gantt chart name').fill('Network upgrade');
await page.keyboard.press('Enter');
check('New chart created without a form and named in the sidebar', await page.locator('.gw-item', { hasText: 'Network upgrade' }).isVisible());
const openChart = async (name = 'Network upgrade') => {
  await page.getByRole('button', { name: 'Gantt Charts' }).first().click();
  await page.locator('.gw-item-main', { hasText: name }).first().click();
};

// --- Acceptance E1/E2 + Scenario A
await page.getByRole('button', { name: 'Calendar' }).first().click();
await fillTask({ date: D1, title: 'Call the bank', category: 'Important reminder' });
await fillTask({ date: D1, title: 'Install core switches', category: 'Work', end: D2, project: 'Network upgrade', gantt: true });
const reminderBars = await page.locator('.month .bar', { hasText: 'Call the bank' }).count();
const workBars = page.locator('.month .bar', { hasText: 'Install core switches' });
const segs = await workBars.count();
check('Both tasks appear in calendar', reminderBars === 1 && segs >= 1, `reminder=${reminderBars}, work segments=${segs}`);
const boxes = [];
for (let i = 0; i < segs; i++) boxes.push(await workBars.nth(i).boundingBox());
const dayBox = await page.locator(`[data-date="${D1}"]`).boundingBox();
const endBox = await page.locator(`[data-date="${D2}"]`).boundingBox();
const startsAt22 = boxes.some((b) => Math.abs(b.x - dayBox.x) < 8);
const endsAt28 = boxes.some((b) => Math.abs(b.x + b.width - (endBox.x + endBox.width)) < 8);
check('Multi-day bar spans 22–28 as continuous segment(s)', startsAt22 && endsAt28 && segs <= 2, `segments=${segs}`);
await page.screenshot({ path: join(shots, 'calendar-month.png') });

// My Tasks
await page.getByRole('button', { name: 'My Tasks' }).first().click();
check('Work task listed in My Tasks', await page.locator('.task-row', { hasText: 'Install core switches' }).count() === 1);

// --- E4: Gantt only shows the selected task
await openChart();
const gNames = await page.locator('.g-left .g-row .nm').allInnerTexts();
check('Gantt shows only Gantt-included task', gNames.some((n) => n.includes('Install core switches')) && !gNames.some((n) => n.includes('Call the bank')), gNames.join(' | '));
await page.screenshot({ path: join(shots, 'gantt.png') });

async function exportAndRead(tag) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel (.xlsx)' }).click()]);
  const p = join(shots, `export-${tag}.xlsx`);
  await dl.saveAs(p);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  return { wb, name: dl.suggestedFilename() };
}
const ymd = (v) => { v = v?.result ?? v; return v instanceof Date ? v.toISOString().slice(0, 10) : String(v); };

// --- E5/E6: export
let { wb, name } = await exportAndRead('1');
const sheets = wb.worksheets.map((w) => w.name);
check('Workbook has Task Register + Gantt Timeline', sheets.join(',') === 'Task Register,Gantt Timeline', `${name}: ${sheets}`);
let reg = wb.getWorksheet('Task Register');
let regRow = null;
reg.eachRow((r) => { if (r.getCell(5).value === 'Install core switches') regRow = r; });
check('Register row has correct dates', regRow && ymd(regRow.getCell(7).value) === D1 && ymd(regRow.getCell(8).value) === D2, regRow ? `${ymd(regRow.getCell(7).value)} → ${ymd(regRow.getCell(8).value)}` : 'missing');
let reminderInExport = false;
reg.eachRow((r) => { if (r.getCell(5).value === 'Call the bank') reminderInExport = true; });
check('Reminder excluded from export', !reminderInExport);
const g = wb.getWorksheet('Gantt Timeline');
const cols = new Map();
g.getRow(7).eachCell((c, i) => { const v = c.value?.result ?? c.value; if (v instanceof Date) cols.set(ymd(v), i); });
let gRow = 0;
g.eachRow((r, n) => { if (String(r.getCell(2).value).startsWith('Install core switches')) gRow = n; });
check('Gantt Timeline has date columns for 22 and 28 and a task row driving the bar', cols.has(D1) && cols.has(D2) && gRow > 0 && ymd(g.getCell(gRow, 4).value) === D1 && ymd(g.getCell(gRow, 5).value) === D2);
check('Export success message shown', await page.locator('.toast.success', { hasText: 'Exported' }).isVisible());

// --- E7: change end date via editor from Gantt
await page.locator('.g-left .nm', { hasText: 'Install core switches' }).click();
await page.locator('#f-end').fill(D3);
await page.getByRole('button', { name: 'Save changes' }).click();
const gEnd = await page.locator('.g-left .g-row', { hasText: 'Install core switches' }).locator('.g-cell-mono').nth(2).innerText();
check('Gantt row shows new end date', gEnd.startsWith('30'), gEnd);
await page.getByRole('button', { name: 'Calendar' }).first().click();
const endBox30 = await page.locator(`[data-date="${D3}"]`).boundingBox();
const bars2 = page.locator('.month .bar', { hasText: 'Install core switches' });
let reaches30 = false;
for (let i = 0; i < await bars2.count(); i++) { const b = await bars2.nth(i).boundingBox(); if (Math.abs(b.x + b.width - (endBox30.x + endBox30.width)) < 8) reaches30 = true; }
check('Calendar bar now ends on 30th', reaches30);

// --- E8: export again
await openChart();
await page.waitForTimeout(400);
({ wb } = await exportAndRead('2'));
reg = wb.getWorksheet('Task Register');
regRow = null;
reg.eachRow((r) => { if (r.getCell(5).value === 'Install core switches') regRow = r; });
check('Second export reflects updated end date', regRow && ymd(regRow.getCell(8).value) === D3 && regRow.getCell(9).value.result === 9);

// --- Scenario F: dependencies
await page.getByRole('button', { name: 'Calendar' }).first().click();
await page.locator(`[data-date="${iso(10)}"]`).click({ position: { x: 60, y: 90 } });
await page.getByLabel('Title').fill('Configure VLANs');
await page.getByRole('radio', { name: 'Work' }).click();
await page.getByRole('radio', { name: /Part of a project/ }).click();
await page.locator('#f-proj').selectOption({ label: 'Network upgrade' });
await page.locator('label[for="f-gantt"]').click();
await page.locator('.dep-opt', { hasText: 'Install core switches' }).locator('input').check();
const snapped = await page.locator('#f-start').inputValue();
check('Linking snaps the task to start after its prerequisite', snapped === iso(31) || snapped > D3, snapped);
check('Editor explains the link', await page.locator('.alert.info', { hasText: 'Linked' }).isVisible());
await page.getByRole('button', { name: 'Save task' }).click();
await openChart();
check('Dependency connector drawn', await page.locator('.g-deps path').count() >= 1);
// Automation: stretch the prerequisite by 3 days and the linked task follows.
const vStart0 = await page.locator('.g-left .g-row', { hasText: 'Configure VLANs' }).locator('.g-cell-mono').nth(1).innerText();
await page.locator('.g-left .nm', { hasText: 'Install core switches' }).click();
const endNow = await page.locator('#f-end').inputValue();
const plus3 = new Date(endNow + 'T00:00:00Z'); plus3.setUTCDate(plus3.getUTCDate() + 3);
await page.locator('#f-end').fill(plus3.toISOString().slice(0, 10));
await page.getByRole('button', { name: 'Save changes' }).click();
const vStart1 = await page.locator('.g-left .g-row', { hasText: 'Configure VLANs' }).locator('.g-cell-mono').nth(1).innerText();
check('Linked task moves automatically when its prerequisite is extended', vStart0 !== vStart1, `${vStart0} → ${vStart1}`);
check('Linked-schedule notice with Undo shown', await page.locator('.toast', { hasText: 'Linked schedule updated' }).isVisible());
await page.locator('.toast', { hasText: 'Linked schedule updated' }).getByRole('button', { name: 'Undo all' }).click();
const vStart2 = await page.locator('.g-left .g-row', { hasText: 'Configure VLANs' }).locator('.g-cell-mono').nth(1).innerText();
check('Undo all restores the linked tasks', vStart2 === vStart0, vStart2);
// cycle prevention
await page.locator('.g-left .nm', { hasText: 'Install core switches' }).click();
const cyc = page.locator('.dep-opt', { hasText: 'Configure VLANs' });
check('Circular dependency prevented in editor', await cyc.locator('input').isDisabled() && (await cyc.innerText()).includes('loop'));
await page.getByRole('button', { name: 'Cancel' }).click();

// --- Scenario C: drag in Gantt
const bar = page.locator('.g-bar', { hasText: 'Configure VLANs' });
const bb = await bar.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 14 * 21 + 3, bb.y + bb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const startTxt = await page.locator('.g-left .g-row', { hasText: 'Configure VLANs' }).locator('.g-cell-mono').nth(1).innerText();
check('Dragging bar 3 weeks reschedules task', !startTxt.startsWith('10 '), startTxt);

// With auto-schedule off, links only warn.
await page.getByLabel('Auto-schedule linked tasks').uncheck();
await page.locator('.g-bar', { hasText: 'Configure VLANs' }).evaluate((el) => {
  const sc = el.closest('.gantt'); const left = sc.querySelector('.g-left').getBoundingClientRect().right;
  sc.scrollLeft += el.getBoundingClientRect().left - (left + 300);
});
const vb = await page.locator('.g-bar', { hasText: 'Configure VLANs' }).boundingBox();
await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
await page.mouse.down();
await page.mouse.move(vb.x + vb.width / 2 - 34 * 11, vb.y + vb.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
check('With auto-schedule off, moving before a prerequisite warns', await page.locator('.toast.warning', { hasText: 'Dependency warning' }).first().isVisible(), (await page.locator('.toast').allInnerTexts()).join(' / '));
await page.getByLabel('Auto-schedule linked tasks').check();

// --- E9: disable include
await page.locator('.g-left .nm', { hasText: 'Install core switches' }).click();
await page.locator('label[for="f-gantt"]').click();
await page.getByRole('button', { name: 'Save changes' }).click();
const gNames2 = await page.locator('.g-left .g-row .nm').allInnerTexts();
check('Excluded task removed from Gantt view', !gNames2.some((n) => n.includes('Install core switches')));
({ wb } = await exportAndRead('3'));
let still = false;
wb.getWorksheet('Task Register').eachRow((r) => { if (r.getCell(5).value === 'Install core switches') still = true; });
check('Excluded task not in next export', !still);
await page.getByRole('button', { name: 'Calendar' }).first().click();
check('Excluded task remains in calendar', await page.locator('.month .bar', { hasText: 'Install core switches' }).count() >= 1);

// --- Scenario D: complete a task from My Tasks
await page.getByRole('button', { name: 'My Tasks' }).first().click();
await page.locator('.task-row', { hasText: 'Call the bank' }).getByRole('checkbox').click();
await page.getByRole('tab', { name: /Completed/ }).click();
check('Completed task appears in Completed tab', await page.locator('.task-row', { hasText: 'Call the bank' }).count() === 1);

// --- Scenario E: month navigation
await page.getByRole('button', { name: 'Calendar' }).first().click();
const title0 = await page.locator('.cal-title').innerText();
await page.locator('.cal-toolbar').getByRole('button', { name: 'Next month' }).click();
const title1 = await page.locator('.cal-title').innerText();
await page.locator('.cal-toolbar').getByRole('button', { name: 'Previous month' }).click();
await page.locator('.cal-toolbar').getByRole('button', { name: 'Next month' }).click();
await page.getByRole('button', { name: 'Today', exact: true }).click();
const title2 = await page.locator('.cal-title').innerText();
check('Month navigation next/prev/today', title0 !== title1 && title0 === title2, `${title0} → ${title1} → ${title2}`);
// Weekday alignment: first cell column of the 1st matches JS weekday
const firstCellIndex = await page.evaluate(() => { const el = document.querySelector('.week .day:not(.out)'); return Array.from(el.parentElement.children).indexOf(el); });
check('1st of month sits under correct weekday', firstCellIndex === new Date(Y, M, 1).getDay(), `col ${firstCellIndex}`);

// --- Gantt Charts workspace: composer, linking, rename, independent charts
await openChart();
await page.getByLabel('Task name').fill('Cable testing');
await page.keyboard.press('Enter');
check('Composer adds a task to the open chart', await page.locator('.g-left .nm', { hasText: 'Cable testing' }).isVisible());
await page.getByRole('button', { name: 'Link calendar tasks' }).first().click();
await page.locator('.link-row', { hasText: 'Call the bank' }).click();
await page.getByRole('button', { name: /^Link 1 task/ }).click();
check('Calendar task linked into the chart', await page.locator('.g-left .nm', { hasText: 'Call the bank' }).isVisible());
await page.locator('.gw-item', { hasText: 'Network upgrade' }).hover();
await page.getByRole('button', { name: 'Options for Network upgrade' }).click();
await page.locator('.gw-menu').getByRole('button', { name: 'Rename' }).click();
await page.getByLabel('Chart name').fill('Network upgrade 2026');
await page.keyboard.press('Enter');
check('Chart renamed from the sidebar', await page.locator('.gw-item', { hasText: 'Network upgrade 2026' }).isVisible() && (await page.locator('.gw-title').innerText()).includes('Network upgrade 2026'));
await page.getByRole('button', { name: 'New Gantt Chart' }).first().click();
await page.getByLabel('Gantt chart name').fill('Office move');
await page.keyboard.press('Enter');
const independent = await page.locator('.g-left .nm', { hasText: 'Cable testing' }).count() === 0 && await page.getByText('Start your plan').isVisible();
check('Each chart is independent (new chart starts empty)', independent);
await page.locator('.gw-item-main', { hasText: 'Network upgrade 2026' }).click();
check('Selecting a chart in the sidebar shows its tasks', await page.locator('.g-left .nm', { hasText: 'Cable testing' }).isVisible());
await page.screenshot({ path: join(shots, 'gantt-workspace.png') });

// --- Persistence
await page.getByRole('button', { name: 'Calendar' }).first().click();
await page.reload();
await page.waitForSelector('.month');
check('Data persists after reload', await page.locator('.month .bar', { hasText: 'Install core switches' }).count() >= 1);

// --- Week & day views + example data screenshots
await page.getByRole('button', { name: 'Week', exact: true }).click();
check('Week view renders', await page.locator('.tg').isVisible());
await page.getByRole('button', { name: 'Month', exact: true }).click();
await page.getByRole('button', { name: 'Settings' }).first().click();
const myTasksBefore = await page.evaluate(() => localStorage.getItem('pastel-planner:v1'));
await page.getByRole('button', { name: 'View example planner' }).click();
check('Example opens on the calendar with a Back button', await page.locator('.month').isVisible() && await page.getByRole('button', { name: 'Back to my planner' }).isVisible());
check('Example shows sample tasks', await page.locator('.month .bar').count() > 3);
await page.screenshot({ path: join(shots, 'calendar-examples.png') });
await page.getByRole('button', { name: 'Gantt Charts' }).first().click();
await page.locator('.gw-item-main', { hasText: 'Office network refresh' }).click();
check('Example chart list shows only the sample project (not my charts)', await page.locator('.gw-item', { hasText: 'Network upgrade 2026' }).count() === 0);
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, 'gantt-examples.png') });
await page.locator('.gw-item-main', { hasText: 'All projects overview' }).click();
check('All projects overview lists every chart', await page.locator('.g-left .nm', { hasText: 'Office network refresh' }).count() >= 1);
await page.getByRole('button', { name: 'Dashboard' }).first().click();
await page.screenshot({ path: join(shots, 'dashboard.png') });
await page.locator('.mini-item').first().click();
await page.screenshot({ path: join(shots, 'editor.png') });
await page.getByLabel('Title').fill('Practice edit in example');
await page.getByRole('button', { name: 'Save changes' }).click();
check('Back button visible on every page in example mode', await page.getByRole('button', { name: 'Back to my planner' }).isVisible());
await page.getByRole('button', { name: 'Back to my planner' }).click();
check('Back returns to own planner with no example tasks', await page.locator('.g-left .nm, .mini-item, .task-row', { hasText: 'Office network refresh' }).count() === 0 && !(await page.locator('.example-banner').count()));
check('Example changes were never saved', (await page.evaluate(() => localStorage.getItem('pastel-planner:v1'))) === myTasksBefore);
await page.getByRole('button', { name: 'Calendar' }).first().click();
check('Own tasks still there after leaving example', await page.locator('.month .bar', { hasText: 'Install core switches' }).count() >= 1);

// Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Calendar' }).first().click({ force: true }).catch(() => {});
await page.evaluate(() => { location.hash = 'calendar'; });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('No horizontal page scroll at phone width', overflow <= 0, `overflow=${overflow}`);
await page.screenshot({ path: join(shots, 'mobile.png') });

check('No uncaught page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
