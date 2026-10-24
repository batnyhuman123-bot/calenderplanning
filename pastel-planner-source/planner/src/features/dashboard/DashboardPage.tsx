import type { Route } from '../../App';
import { IAlert, IFolder, IPlus } from '../../components/Icons';
import { useEditor } from '../../components/TaskEditor';
import { useStore } from '../../data/store';
import { addDays, diffDays, fmtDate, fmtTime, relativeDay, toEpochDay } from '../../domain/dates';
import { bucket, isOverdue, projectProgress, sortTasks } from '../../domain/tasks';
import type { Task } from '../../domain/types';
import { PROJECT_STATUS_LABEL } from '../../domain/types';

export function DashboardPage({ go, openProject }: { go(r: Route): void; openProject(id: string): void }) {
  const { data, today } = useStore();
  const { openNew, openTask } = useEditor();
  const ws = data.settings.weekStartsOn;
  const b = data.tasks.map((t) => ({ t, b: bucket(t, today, ws) }));
  const todayList = sortTasks(b.filter((x) => x.b.today).map((x) => x.t), 'due', data.projects)
    .sort((a, c) => Number(a.allDay) - Number(c.allDay) || (a.startTime ?? '').localeCompare(c.startTime ?? ''));
  const overdue = sortTasks(b.filter((x) => x.b.overdue).map((x) => x.t), 'priority', data.projects);
  const week = b.filter((x) => x.b.thisWeek).map((x) => x.t);
  const upcoming = sortTasks(data.tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && toEpochDay(t.startDate) > toEpochDay(today) && toEpochDay(t.startDate) <= toEpochDay(addDays(today, 14))), 'due', data.projects);
  const completed = data.tasks.filter((t) => t.status === 'completed').sort((a, c) => (c.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const activeProjects = data.projects.filter((p) => p.status === 'active' || p.status === 'planning');
  const milestones = data.tasks.filter((t) => t.isMilestone && t.projectId && t.status !== 'completed' && toEpochDay(t.startDate) >= toEpochDay(today))
    .sort((a, c) => a.startDate.localeCompare(c.startDate)).slice(0, 6);
  const cat = (id: string) => data.categories.find((c) => c.id === id) ?? data.categories[0];

  const Item = ({ t, when }: { t: Task; when?: string }) => (
    <button className="mini-item" onClick={() => openTask(t.id)}>
      <span className="dot" style={{ background: t.isMilestone ? data.settings.milestoneColor : cat(t.categoryId).color, width: 10, height: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)' }} />
      <span style={{ minWidth: 0 }}>
        <div className="ttl">{t.title}</div>
        <div className="sub">{cat(t.categoryId).name}{t.projectId ? ` · ${data.projects.find((p) => p.id === t.projectId)?.name ?? ''}` : ''}{isOverdue(t, today) ? ' · overdue' : ''}</div>
      </span>
      <span className="when">{when ?? relativeDay(t.endDate, today)}</span>
    </button>
  );
  const Empty = ({ children }: { children: string }) => <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 10px' }}>{children}</p>;

  return (
    <div className="page">
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{fmtDate(today, { weekday: true })}</h2>
          <p className="muted" style={{ margin: 0 }}>{todayList.length ? `${todayList.length} thing${todayList.length > 1 ? 's' : ''} on today.` : 'Nothing scheduled today.'}{overdue.length ? ` ${overdue.length} overdue.` : ''}</p>
        </div>
        <div className="hstack">
          <button className="btn" onClick={() => go('gantt')}><IFolder size={14} />Open Gantt charts</button>
          <button className="btn btn-primary" onClick={() => openNew({ startDate: today })}><IPlus size={14} />Add task</button>
        </div>
      </div>

      <div className="stats">
        <button className="stat" onClick={() => go('tasks')}><span className="l">Today</span><span className="v">{todayList.length}</span></button>
        <button className={`stat ${overdue.length ? 'alert-v' : ''}`} onClick={() => go('tasks')}><span className="l">{overdue.length > 0 && <IAlert size={12} />}Overdue</span><span className="v">{overdue.length}</span></button>
        <button className="stat" onClick={() => go('tasks')}><span className="l">Due this week</span><span className="v">{week.length}</span></button>
        <button className="stat" onClick={() => go('tasks')}><span className="l">Completed</span><span className="v">{completed.length}</span></button>
        <button className="stat" onClick={() => go('gantt')}><span className="l">Active projects</span><span className="v">{activeProjects.length}</span></button>
      </div>

      <div className="dash-grid">
        <section className="card span-7" aria-labelledby="d-today">
          <div className="card-head"><h2 id="d-today">Today</h2><button className="btn btn-sm btn-ghost" onClick={() => go('calendar')}>Open calendar</button></div>
          <div className="card-body mini-list">
            {todayList.length ? todayList.map((t) => <Item key={t.id} t={t} when={t.allDay ? (t.startDate !== t.endDate ? `until ${fmtDate(t.endDate, { year: false })}` : 'All day') : fmtTime(t.startTime)} />) : <Empty>Your day is clear. Add something or enjoy the space.</Empty>}
          </div>
        </section>
        <section className="card span-5" aria-labelledby="d-overdue">
          <div className="card-head"><h2 id="d-overdue">Overdue</h2></div>
          <div className="card-body mini-list">
            {overdue.length ? overdue.slice(0, 7).map((t) => <Item key={t.id} t={t} when={`${-diffDays(today, t.endDate)}d late`} />) : <Empty>Nothing overdue. Nicely done.</Empty>}
          </div>
        </section>
        <section className="card span-7" aria-labelledby="d-up">
          <div className="card-head"><h2 id="d-up">Upcoming (next 14 days)</h2></div>
          <div className="card-body mini-list">
            {upcoming.length ? upcoming.slice(0, 8).map((t) => <Item key={t.id} t={t} when={relativeDay(t.startDate, today)} />) : <Empty>No upcoming tasks in the next two weeks.</Empty>}
          </div>
        </section>
        <section className="card span-5" aria-labelledby="d-ms">
          <div className="card-head"><h2 id="d-ms">Upcoming milestones</h2><button className="btn btn-sm btn-ghost" onClick={() => go('gantt')}>Gantt chart</button></div>
          <div className="card-body mini-list">
            {milestones.length ? milestones.map((t) => <Item key={t.id} t={t} when={fmtDate(t.startDate, { year: false })} />) : <Empty>No upcoming project milestones.</Empty>}
          </div>
        </section>
        <section className="card span-7" aria-labelledby="d-proj">
          <div className="card-head"><h2 id="d-proj">Project progress</h2></div>
          <div className="card-body">
            {activeProjects.length ? activeProjects.map((p) => {
              const prog = projectProgress(p, data.tasks);
              const left = diffDays(today, p.targetEndDate);
              return (
                <button key={p.id} className="proj-sum" onClick={() => openProject(p.id)}>
                  <span className="top"><strong>{p.name}</strong><span className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{prog}% · {PROJECT_STATUS_LABEL[p.status]} · {left >= 0 ? `${left}d left` : `${-left}d past target`}</span></span>
                  <span className="progress" role="progressbar" aria-valuenow={prog} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}><i style={{ width: `${prog}%` }} /></span>
                </button>
              );
            }) : <Empty>No active projects. Start one under Gantt Charts.</Empty>}
          </div>
        </section>
        <section className="card span-5" aria-labelledby="d-done">
          <div className="card-head"><h2 id="d-done">Recently completed</h2></div>
          <div className="card-body mini-list">
            {completed.length ? completed.slice(0, 5).map((t) => <Item key={t.id} t={t} when={t.completedAt ? fmtDate(t.completedAt.slice(0, 10), { year: false }) : ''} />) : <Empty>Completed tasks will show up here.</Empty>}
          </div>
        </section>
      </div>
    </div>
  );
}
