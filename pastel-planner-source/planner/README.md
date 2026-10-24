# Pastel Planner

A personal schedule and project planner. It combines a monthly calendar, a task manager, project and phase management, a Gantt chart with dependencies and an Excel (.xlsx) Gantt export. Every view works from the same task records, so you never enter a task twice.

## Run it

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # unit tests (dates, layout, validation, dependencies, Excel)
npm run build            # type-check + single-file production build -> dist/index.html
npm run build:artifact   # also writes dist/artifact.html (page body for Claude artifact hosting)
```

End-to-end acceptance run (Playwright, uses the built file):

```bash
npm run build
npx playwright install chromium        # first time only
node tests/e2e/acceptance.mjs           # 28 checks; screenshots + exported workbooks in tests/e2e/out
```

Requires Node 18+.

## Architecture

| Layer | Location | Responsibility |
|---|---|---|
| Domain model | `src/domain/types.ts` | `Task`, `Project`, `Phase`, `Category`, `Settings` |
| Date maths | `src/domain/dates.ts` | Integer "epoch day" arithmetic: no DST or off-by-one errors, leap-year aware |
| Business rules | `src/domain/tasks.ts` | Validation, durations, status side effects, FS dependency checks, cycle detection, filters |
| Calendar layout | `src/domain/calendarLayout.ts` | Lane packing for multi-day bars, week-row splitting, "+N more", timed-event columns |
| Gantt model | `src/domain/gantt.ts` | Project → Phase → Task → Subtask rows, WBS numbers, timeline scales |
| Persistence | `src/data/storage.ts` | `StorageAdapter` interface; Claude artifact database adapter and localStorage adapter |
| State | `src/data/store.tsx` | One React context; every mutation goes through it and is persisted |
| Export | `src/export/excel.ts` | ExcelJS workbook: Task Register + Gantt Timeline |
| UI | `src/features/*`, `src/components/*` | Calendar (month/week/day), My Tasks, Dashboard, Gantt Charts workspace (chart list + chart + composer), Settings, task editor |

**Stack:** React 18 + TypeScript + Vite. No UI or calendar library. The multi-day bar layout, week/day time grid and Gantt (dependency connectors, drag/resize, baselines) are custom components, because the requirements (continuous bars across week rows, FS arrows, drag scheduling on shared records) are central and small enough to own. The only runtime dependencies are React and ExcelJS.

**Storage:** When the app runs as a published Claude artifact, data is saved in the artifact's database under each viewer's private path (`data/users/<id>/planner/...`), one document per record. Anywhere else it uses `localStorage`. Adding a server database means writing one new `StorageAdapter`.

**Dates:** Calendar dates are stored as ISO calendar dates (`YYYY-MM-DD`), which are timezone-free date values. All arithmetic converts them to integer day numbers. Audit fields (`createdAt`, `updatedAt`, `completedAt`) are ISO timestamps.

**Duration rule:** calendar days, inclusive (`End − Start + 1`). Milestones = 0. Working days (Mon–Fri, no holiday calendar) are shown for information and in the Excel register. Scheduling uses calendar days.

## Gantt Charts workspace

The **Gantt Charts** section works like a chat app: a list of your charts on the left and the selected chart in the main area.

- **New Gantt Chart** creates a chart immediately, with no setup form. The title is ready to type into; press Enter to name it, and the name appears in the list.
- Each chart is one independent project, with its own tasks, phases, milestones, timeline, progress and Excel export.
- The list is sorted by recent activity and grouped into Today, Previous 7 days, Previous 30 days and Older. Completed and archived charts are folded away at the bottom. You can search the list or hide it with the ‹ button.
- Each chart's **⋯** menu offers: Rename (or double-click the name), Project details, Duplicate (copies phases, tasks and links, with progress reset), Mark as completed or Reopen, and Delete (keeping or deleting its tasks).
- Click the title at the top of a chart to rename it.
- Type a task in the box at the bottom and press Enter to add it. You can set its start date, number of days, phase, whether it is a milestone, and whether it starts after the previous task (which links them for auto-scheduling). **More options…** opens the full task editor.
- **Link calendar tasks** pulls existing calendar tasks into the chart. They stay on the calendar too.
- **All projects overview** shows every chart in one view, with filters and a combined Excel export.
- The Calendar remains a separate page. Calendar tasks join a chart either through Link calendar tasks or through the task editor's project setting.

## Gantt format

The Gantt chart follows the classic Excel layout popularised by conditional-formatting tutorials (such as Kenji Explains' "Gantt Chart in Excel"):

- **Inputs:** *Project Start* and *Display Week*. In Excel these are cells C3 and C4: change them and the whole timeline shifts. In the app, the Display Week control scrolls the chart.
- **Left columns:** TASK, PROGRESS (with a data bar), START, END and DAYS.
- **Grouping:** project and phase header rows. Each phase has its own pastel colour, and its tasks' bars use it. You can change a phase's colour from a chart's Phases panel, or switch to colour-by-category.
- **Timeline:** a daily grid under weekly date headers, with day numbers and M–S weekday initials. Weekends are shaded.
- **Bars:** in Excel, bars, progress fill, milestones (◆) and today's column are all conditional formatting driven by the cells, so the workbook stays live. Panes are frozen below the header and to the right of DAYS.

## Linked scheduling (automation)

Auto-scheduling is on by default. You can switch it off on the Gantt Chart View toolbar or in Settings.

- A task that depends on another (finish-to-start) starts the day after its latest prerequisite finishes, plus its own gap.
- Move, extend or shorten a task and every task linked after it moves too, in either direction. A notice lists what moved and offers **Undo all**.
- If you move a dependent task by hand, its gap changes. Moving it before its prerequisite finishes counts as an overlap and shows a warning.
- When you tick a prerequisite in the task editor, the task snaps to start after it. The editor shows the link, for example "Linked: starts the day after "Procure switches" finishes."
- Tasks with subtasks become summary tasks. Their dates and progress follow their subtasks, and dragging one moves all its subtasks together.
- Phases stretch to cover their tasks.
- In the exported workbook (Gantt Timeline sheet), linked START cells are formulas such as `=MAX($E$15)+1`, END is `=START+DAYS-1`, and summary rows use `MIN`/`MAX` and weighted progress. Change a task's START or DAYS in Excel and everything after it recalculates, bars included. Linked START cells are shown in purple italics; the AFTER column lists each task's prerequisites by WBS number.

## Feature status

Implemented:

- Month, week and day calendar. Prev/next/Today, month-year picker and view switcher. Correct weekday alignment for any year. Today and the selected date are marked differently.
- Click a date (or its number) to add a task, or drag across dates to add a multi-day task. Multi-day tasks are one record, drawn as continuous bars that split into connected segments across week rows. Overflow shows "+N more". Keyboard: arrow keys move between days, Enter adds a task, Alt+←/→ changes period, T jumps to today.
- Task editor (side panel): every field from the brief, plus Include in Gantt Chart, actual start/finish and baseline display. Validation messages, an unsaved-changes warning, duplicate, mark complete, and delete with confirmation and undo.
- Categories with a pastel palette, a visible legend and calendar filtering. Colours can be edited in Settings and apply everywhere, including the Excel export. Text colour is derived for contrast, and the Settings page shows the contrast ratio.
- My Tasks: All, Today, Upcoming, Overdue and Completed views. Search, filters (category, project, priority, status, date range), sorting, and quick status change, complete and delete.
- Dashboard: today, overdue, due this week, upcoming, recently completed, active project progress and upcoming milestones.
- Gantt Charts workspace: one chart per project, created and renamed in place (see above). Phases can be added, reordered, coloured and deleted.
- Gantt Chart View: shows only tasks with Include in Gantt Chart on. Grouped by project and phase, with WBS numbers, subtasks, collapse/expand, Day/Week/Month/Quarter zoom, sticky columns and headers, a today marker, milestones, FS dependency arrows (dashed red when violated) and tooltips. Drag a bar to move it, drag its ends to resize, or use Alt+arrow keys. You get a warning (with Undo) when a move breaks a dependency. Baselines can be saved and shown.
- Circular dependencies are blocked in the editor and by validation.
- Excel export: Task Register and Gantt Timeline sheets, with typed dates, formulas for duration and working days, frozen panes, filters, data validation and conditional formatting. The timeline bars are conditional formats driven by each row's Start/End/% cells, so they move if you edit dates in Excel. Exports respect the project, status and date filters.
- Backup and restore (JSON), CSV export of tasks, and a "delete all data" option.
- The planner starts empty. **Settings → View example planner** opens a filled-in practice copy with a "Back to my planner" button on every page. Nothing done there is saved, and your own data is not touched.
- In-app reminders: a banner appears when a reminder is due while the planner is open.

Deferred or limited:

- Reminders do not send background, push or email notifications.
- No cloud sync when not hosted in Claude. Browser storage is per-browser, so use backup/restore to move data.
- Only finish-to-start dependencies (no start-to-start or finish-to-finish).
- No holiday calendar or working-day scheduling.
- Drag-and-drop is in the Gantt chart only. In the calendar, edit dates in the task editor.
- Recurring tasks are not supported.

## Tests

- `tests/domain.test.ts`: weekday alignment, leap years, month grids, DST-safe arithmetic, durations, lane layout and overflow, timed overlaps, validation, circular dependencies, FS warnings, subtask cascade, status side effects, buckets, project progress, filters, Gantt hierarchy and range.
- `tests/excel.test.ts`: checks that both sheets exist, only Gantt tasks are exported, dates, duration formula results, frozen panes, conditional-format formulas and milestone cells are correct, and that re-exports pick up date changes and exclusions.
- `tests/e2e/acceptance.mjs`: the brief's scenarios A–F and acceptance test E1–E9 in a real browser, plus persistence after reload and a no-horizontal-scroll check at phone width.
