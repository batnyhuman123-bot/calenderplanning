import { addDays, startOfWeek } from '../domain/dates';
import { newTask, nowISO, uid } from '../domain/tasks';
import type { ISODate, Phase, Project, Task } from '../domain/types';

/**
 * Example plan loaded on request from the welcome card or Settings. Every
 * record is flagged `isExample` so the UI can label it and Settings can
 * remove it in one step. Dates are relative to today.
 */
export function exampleData(today: ISODate): { projects: Project[]; phases: Phase[]; tasks: Task[] } {
  const d = (n: number) => addDays(today, n);
  const ts = nowISO();
  const pid = uid('p');
  const project: Project = {
    id: pid, name: 'Office network refresh', description: 'Replace core switches and Wi-Fi access points across two floors.',
    startDate: d(-10), targetEndDate: d(32), status: 'active', priority: 'high', owner: 'Me',
    progressMode: 'auto', manualProgress: 0, createdAt: ts, updatedAt: ts, isExample: true,
  };
  const ph = (name: string, s: number, e: number, order: number): Phase => ({ id: uid('ph'), projectId: pid, name, startDate: d(s), endDate: d(e), order });
  const plan = ph('Planning & design', -10, 2, 0);
  const build = ph('Implementation', 3, 22, 1);
  const cut = ph('Cutover & handover', 23, 32, 2);

  const base = { projectId: pid, categoryId: 'work', includeInGantt: true, isExample: true } as const;
  const survey = newTask({ ...base, title: 'Site survey & cabling audit', startDate: d(-10), endDate: d(-6), phaseId: plan.id, status: 'completed', progress: 100, completedAt: ts, actualStart: d(-10), actualEnd: d(-6), priority: 'medium' });
  const design = newTask({ ...base, title: 'Network design & IP plan', startDate: d(-5), endDate: d(1), phaseId: plan.id, status: 'in_progress', progress: 70, priority: 'high', dependencyIds: [survey.id], actualStart: d(-5) });
  const signoff = newTask({ ...base, title: 'Design sign-off', startDate: d(2), endDate: d(2), phaseId: plan.id, isMilestone: true, categoryId: 'work', priority: 'high', dependencyIds: [design.id] });
  const procure = newTask({ ...base, title: 'Procure switches & APs', startDate: d(3), endDate: d(9), phaseId: build.id, priority: 'high', dependencyIds: [signoff.id] });
  const core = newTask({ ...base, title: 'Install core switches', startDate: d(10), endDate: d(15), phaseId: build.id, dependencyIds: [procure.id] });
  const core1 = newTask({ ...base, title: 'Rack & power', startDate: d(10), endDate: d(11), phaseId: build.id, parentTaskId: core.id });
  const core2 = newTask({ ...base, title: 'Configure VLANs', startDate: d(12), endDate: d(15), phaseId: build.id, parentTaskId: core.id, dependencyIds: [core1.id] });
  const wifi = newTask({ ...base, title: 'Deploy Wi-Fi access points', startDate: d(14), endDate: d(22), phaseId: build.id, dependencyIds: [procure.id] });
  const cutover = newTask({ ...base, title: 'Weekend cutover', startDate: d(23), endDate: d(24), phaseId: cut.id, priority: 'critical', dependencyIds: [core.id, wifi.id] });
  const handover = newTask({ ...base, title: 'Documentation & handover', startDate: d(25), endDate: d(31), phaseId: cut.id, dependencyIds: [cutover.id] });
  const golive = newTask({ ...base, title: 'Go-live', startDate: d(32), endDate: d(32), phaseId: cut.id, isMilestone: true, dependencyIds: [handover.id] });

  const ws = startOfWeek(today, 1);
  const personal: Task[] = [
    newTask({ title: 'Vendor kickoff call', categoryId: 'meeting', startDate: d(0), endDate: d(0), allDay: false, startTime: '10:00', endTime: '11:00', projectId: pid, isExample: true }),
    newTask({ title: 'Morning run', categoryId: 'daily', startDate: d(0), endDate: d(0), allDay: false, startTime: '06:30', endTime: '07:15', isExample: true }),
    newTask({ title: 'Team stand-up', categoryId: 'meeting', startDate: addDays(ws, 7), endDate: addDays(ws, 7), allDay: false, startTime: '09:30', endTime: '09:45', isExample: true }),
    newTask({ title: 'Dentist appointment', categoryId: 'personal', startDate: d(3), endDate: d(3), allDay: false, startTime: '16:00', endTime: '17:00', isExample: true }),
    newTask({ title: 'Renew car insurance', categoryId: 'reminder', startDate: d(5), endDate: d(5), priority: 'high', isExample: true }),
    newTask({ title: 'Family trip to Penang', categoryId: 'personal', startDate: d(8), endDate: d(11), isExample: true }),
    newTask({ title: 'Submit expense claims', categoryId: 'work', startDate: d(-3), endDate: d(-2), priority: 'medium', isExample: true }),
    newTask({ title: 'Read: SRE handbook ch. 4', categoryId: 'other', startDate: d(1), endDate: d(1), isExample: true, status: 'completed', progress: 100, completedAt: ts }),
  ];

  return {
    projects: [project],
    phases: [plan, build, cut],
    tasks: [survey, design, signoff, procure, core, core1, core2, wifi, cutover, handover, golive, ...personal],
  };
}
