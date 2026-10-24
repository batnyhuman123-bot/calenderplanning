import { useRef, useState } from 'react';
import { CatIcon, CATEGORY_ICON_OPTIONS, IDownload, IPlus, IUpload } from '../../components/Icons';
import { catVars, Toggle, useConfirm } from '../../components/ui';
import { useStore } from '../../data/store';
import { normalize } from '../../data/storage';
import { contrastRatio, inkFor } from '../../domain/colors';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, emptyData } from '../../domain/defaults';
import { uid } from '../../domain/tasks';
import type { Category, CategoryIcon, PlannerData } from '../../domain/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../../domain/types';
import { saveFile, stamp } from '../../export/download';

export function SettingsPage() {
  const store = useStore();
  const { data } = store;
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const examples = data.tasks.some((t) => t.isExample) || data.projects.some((p) => p.isExample);

  const backup = async () => {
    const payload = JSON.stringify({ app: 'pastel-planner', version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
    try {
      const r = await saveFile(`planner-backup-${stamp()}.json`, new Blob([payload], { type: 'application/json' }));
      if (r === 'saved') store.notify('success', 'Backup downloaded.');
      else if (r === 'unavailable') store.notify('error', 'Downloads are not available in this view.');
    } catch (e: any) { store.notify('error', e.message); }
  };

  const csv = async () => {
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['id', 'title', 'category', 'start_date', 'end_date', 'start_time', 'end_time', 'all_day', 'project', 'phase', 'priority', 'status', 'progress', 'milestone', 'include_in_gantt', 'dependencies', 'completed_at', 'description'];
    const lines = data.tasks.map((t) => [
      t.id, t.title, data.categories.find((c) => c.id === t.categoryId)?.name, t.startDate, t.endDate, t.startTime, t.endTime, t.allDay,
      data.projects.find((p) => p.id === t.projectId)?.name, data.phases.find((p) => p.id === t.phaseId)?.name,
      PRIORITY_LABEL[t.priority], STATUS_LABEL[t.status], t.progress, t.isMilestone, t.includeInGantt, t.dependencyIds.join(' '), t.completedAt, t.description,
    ].map(esc).join(','));
    try {
      const r = await saveFile(`planner-tasks-${stamp()}.csv`, new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv' }));
      if (r === 'saved') store.notify('success', 'Task list exported as CSV.');
    } catch (e: any) { store.notify('error', e.message); }
  };

  const onImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      const incoming: PlannerData = normalize(json.data ?? json);
      const r = await confirm({
        title: 'Replace all planner data?',
        message: `The backup contains ${incoming.tasks.length} tasks and ${incoming.projects.length} projects. Everything currently in your planner will be replaced. Download a backup first if you might need it.`,
        confirmLabel: 'Replace data', danger: true,
      });
      if (r !== 'confirm') return;
      await store.replaceAll(incoming);
      store.notify('success', 'Backup restored.');
    } catch (e: any) {
      store.notify('error', `That file could not be imported: ${e?.message ?? 'not a planner backup'}.`);
    }
  };

  const reset = async () => {
    const r = await confirm({ title: 'Delete all planner data?', message: 'All tasks, projects, phases and custom categories will be removed permanently. Download a backup first if you might need it.', confirmLabel: 'Delete everything', danger: true });
    if (r !== 'confirm') return;
    await store.replaceAll({ ...emptyData(), settings: { ...DEFAULT_SETTINGS, onboarded: true } });
    store.notify('info', 'All data deleted.');
  };

  const addCategory = () => {
    const name = newName.trim();
    if (!name) return;
    store.saveCategory({ id: uid('c'), name, color: '#E2E8F0', icon: 'star', isActive: true, builtIn: false, order: data.categories.length });
    setNewName('');
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="settings-grid">
        <section className="card" aria-labelledby="s-cat">
          <div className="card-head"><h2 id="s-cat">Categories & colours</h2>
            <button className="btn btn-sm btn-ghost" onClick={async () => {
              const r = await confirm({ title: 'Restore default colours?', message: 'Built-in categories go back to the pastel defaults. Custom categories are kept.', confirmLabel: 'Restore' });
              if (r === 'confirm') { DEFAULT_CATEGORIES.forEach((c) => { const cur = data.categories.find((x) => x.id === c.id); store.saveCategory({ ...c, name: cur?.name ?? c.name, isActive: cur?.isActive ?? true }); }); store.saveSettings({ milestoneColor: DEFAULT_SETTINGS.milestoneColor, completedColor: DEFAULT_SETTINGS.completedColor }); }
            }}>Restore defaults</button>
          </div>
          <div className="card-body">
            <p className="muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>Colour changes apply everywhere: calendar, task lists, Gantt chart and Excel exports. Text colour is derived automatically for readability.</p>
            {data.categories.map((c) => <CategoryRow key={c.id} c={c} />)}
            <div className="cat-row">
              <span className="color-input" style={{ display: 'grid', placeItems: 'center' }}><IPlus size={14} /></span>
              <input className="input input-sm" style={{ width: '100%' }} placeholder="New category name" aria-label="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
              <span className="cat-contrast" />
              <button className="btn btn-sm" onClick={addCategory} disabled={!newName.trim()}>Add</button>
            </div>
            <div className="cat-row">
              <input type="color" className="color-input" aria-label="Milestone colour" value={data.settings.milestoneColor} onChange={(e) => store.saveSettings({ milestoneColor: e.target.value.toUpperCase() })} />
              <span className="chip" style={catVars(data.settings.milestoneColor)}>◆ Milestones & deadlines</span>
              <ContrastNote color={data.settings.milestoneColor} />
              <span />
            </div>
            <div className="cat-row">
              <input type="color" className="color-input" aria-label="Completed colour" value={data.settings.completedColor} onChange={(e) => store.saveSettings({ completedColor: e.target.value.toUpperCase() })} />
              <span className="chip" style={catVars(data.settings.completedColor)}>✓ Completed (Excel export)</span>
              <ContrastNote color={data.settings.completedColor} />
              <span />
            </div>
          </div>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card" aria-labelledby="s-pref">
            <div className="card-head"><h2 id="s-pref">Preferences</h2></div>
            <div className="card-body stack">
              <div className="field">
                <span className="field-label">Week starts on</span>
                <div className="seg" role="group" aria-label="Week starts on">
                  <button aria-pressed={data.settings.weekStartsOn === 0} onClick={() => store.saveSettings({ weekStartsOn: 0 })}>Sunday</button>
                  <button aria-pressed={data.settings.weekStartsOn === 1} onClick={() => store.saveSettings({ weekStartsOn: 1 })}>Monday</button>
                </div>
              </div>
              <Toggle id="s-auto" checked={data.settings.autoSchedule} onChange={(v) => store.saveSettings({ autoSchedule: v })} label="Auto-schedule linked tasks" hint="A task that depends on another starts after it finishes. Move or stretch a task and everything linked after it follows; parent tasks and phases resize to fit." />
              <Toggle id="s-base" checked={data.settings.showBaseline} onChange={(v) => store.saveSettings({ showBaseline: v })} label="Show baselines in Gantt charts" hint="Grey lines under each bar show the dates saved with “Save baseline”." />
            </div>
          </section>

          <section className="card" aria-labelledby="s-example">
            <div className="card-head"><h2 id="s-example">Example planner</h2></div>
            <div className="card-body stack">
              <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>Not sure how something works? Open a filled-in example with tasks, a multi-day trip and a sample project with a Gantt chart. It's a separate practice copy: nothing you do there is saved, and your own planner stays exactly as it is.</p>
              {store.demo
                ? <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => store.exitExample()}>Back to my planner</button>
                : <button className="btn btn-soft" style={{ alignSelf: 'flex-start' }} onClick={() => { store.enterExample(); location.hash = 'calendar'; }}>View example planner</button>}
            </div>
          </section>

          <section className="card" aria-labelledby="s-data">
            <div className="card-head"><h2 id="s-data">Data & backup</h2></div>
            <div className="card-body stack">
              {store.demo && <div className="alert warn"><span>You're in the example planner. Go back to your planner to back up, restore or delete your own data.</span></div>}
              <div className="alert info"><span>Saved to: <strong>{store.storageLabel}</strong>. {store.storageKind === 'claude' ? 'Your planner is private to you and follows your Claude account across devices.' : store.storageKind === 'browser' ? 'Data stays in this browser only. Clearing site data deletes it, so keep a backup.' : 'Nothing is saved in this session. Export a backup before closing.'}</span></div>
              <div className="hstack">
                <button className="btn" onClick={backup} disabled={store.demo}><IDownload size={14} />Download backup (.json)</button>
                <button className="btn" onClick={csv} disabled={store.demo}><IDownload size={14} />Export tasks (.csv)</button>
                <button className="btn" onClick={() => fileRef.current?.click()} disabled={store.demo}><IUpload size={14} />Restore from backup</button>
                <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
              </div>
              <div className="hstack">
                {examples && !store.demo && <button className="btn btn-ghost" onClick={() => { store.removeExamples(); store.notify('info', 'Example tasks removed from your planner.'); }}>Remove example tasks from my planner</button>}
                <button className="btn btn-danger" onClick={reset} disabled={store.demo}>Delete all data</button>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-xs)' }}>Reminders show as a banner while the planner is open. This app does not send background, email or push notifications.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ContrastNote({ color }: { color: string }) {
  const r = contrastRatio(color, inkFor(color));
  return <span className="contrast cat-contrast" style={{ color: r >= 4.5 ? 'var(--sage-ink)' : 'var(--danger)' }} title="Contrast between label text and the colour">{r.toFixed(1)}:1 {r >= 4.5 ? 'AA' : 'low'}</span>;
}

function CategoryRow({ c }: { c: Category }) {
  const store = useStore();
  const confirm = useConfirm();
  const used = store.data.tasks.filter((t) => t.categoryId === c.id).length;
  return (
    <div className="cat-row">
      <input type="color" className="color-input" aria-label={`${c.name} colour`} value={c.color} onChange={(e) => store.saveCategory({ ...c, color: e.target.value.toUpperCase() })} />
      <span className="hstack" style={{ gap: 6, minWidth: 0 }}>
        <span className="chip" style={catVars(c.color)}><CatIcon icon={c.icon} size={11} /></span>
        <input className="input input-sm" style={{ flex: 1, minWidth: 80 }} aria-label="Category name" defaultValue={c.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) store.saveCategory({ ...c, name: v }); else e.target.value = c.name; }} />
        <select className="select select-sm" aria-label={`${c.name} icon`} value={c.icon} onChange={(e) => store.saveCategory({ ...c, icon: e.target.value as CategoryIcon })}>
          {CATEGORY_ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </span>
      <ContrastNote color={c.color} />
      <span className="hstack" style={{ gap: 4 }}>
        <label className="hstack" style={{ gap: 4, fontSize: 'var(--fs-xs)' }} title="Inactive categories are hidden from pickers and filters">
          <input type="checkbox" checked={c.isActive} onChange={(e) => store.saveCategory({ ...c, isActive: e.target.checked })} />Active
        </label>
        {!c.builtIn && (
          <button className="btn btn-sm btn-ghost" onClick={async () => {
            if (used) { store.notify('warning', `“${c.name}” is used by ${used} task${used > 1 ? 's' : ''}. Mark it inactive instead, or move those tasks first.`); return; }
            const r = await confirm({ title: `Delete “${c.name}”?`, confirmLabel: 'Delete', danger: true });
            if (r === 'confirm') store.deleteCategory(c.id);
          }}>Delete</button>
        )}
      </span>
    </div>
  );
}
