// Writes a sample workbook from the example plan: npx vite-node scripts/sample-export.ts <out.xlsx>
import { writeFileSync } from 'node:fs';
import { exampleData } from '../src/data/seed';
import { emptyData } from '../src/domain/defaults';
import { ganttTasks } from '../src/domain/gantt';
import { buildGanttWorkbook } from '../src/export/excel';

const today = new Date().toISOString().slice(0, 10);
const d = emptyData();
Object.assign(d, exampleData(today));
const wb = buildGanttWorkbook(d, ganttTasks(d, {}), { today, scopeLabel: 'All projects (example)' });
const buf = await wb.xlsx.writeBuffer();
writeFileSync(process.argv[2] ?? 'sample-gantt.xlsx', Buffer.from(buf));
console.log('written');
