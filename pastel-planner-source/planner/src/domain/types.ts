/**
 * Core domain model shared by every view (Calendar, My Tasks, Dashboard,
 * Projects, Gantt, Excel export). There is exactly ONE record per task.
 *
 * Date conventions
 *  - Calendar dates are ISO 8601 calendar dates ("YYYY-MM-DD"). They are
 *    timezone-free date values, which is what all-day / multi-day items
 *    need; all arithmetic converts them to integer "epoch days"
 *    (see dates.ts) so there are no DST or off-by-one errors.
 *  - Times of day are "HH:MM" (24h) and only meaningful when allDay=false.
 *  - Audit stamps (createdAt, updatedAt, completedAt) are ISO 8601
 *    date-times in UTC.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO timestamp
export type LocalDateTime = string; // YYYY-MM-DDTHH:MM (viewer's local wall clock)
export type TimeOfDay = string; // HH:MM

export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  /** Planned start (inclusive). */
  startDate: ISODate;
  /** Planned end (inclusive). Equal to startDate for single-day items and milestones. */
  endDate: ISODate;
  startTime: TimeOfDay | null;
  endTime: TimeOfDay | null;
  allDay: boolean;
  projectId: string | null;
  phaseId: string | null;
  parentTaskId: string | null;
  priority: Priority;
  status: TaskStatus;
  /** 0–100 */
  progress: number;
  isMilestone: boolean;
  /** Finish-to-Start predecessors: this task should start after each of these finishes. */
  dependencyIds: string[];
  /** Gap in days between the latest prerequisite's finish and this task's start (negative = overlap). Used by auto-scheduling. */
  lagDays?: number;
  /** Whether this task appears in the Gantt Chart View, project timelines and the Excel export. */
  includeInGantt: boolean;
  reminderAt: LocalDateTime | null;
  reminderDismissed: boolean;
  notes: string;
  /** Baseline (snapshot of planned dates) for plan-vs-actual comparison. */
  baselineStart: ISODate | null;
  baselineEnd: ISODate | null;
  /** Actual dates, recorded when work starts / completes. */
  actualStart: ISODate | null;
  actualEnd: ISODate | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt: ISODateTime | null;
  isExample?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  startDate: ISODate;
  targetEndDate: ISODate;
  status: ProjectStatus;
  priority: Priority;
  owner: string;
  /** 'auto' derives progress from tasks (duration-weighted); 'manual' uses manualProgress. */
  progressMode: 'auto' | 'manual';
  manualProgress: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  isExample?: boolean;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  order: number;
  /** Pastel colour for the phase band and its task bars (Gantt "colour by phase"). */
  color?: string;
}

export type CategoryIcon = 'briefcase' | 'heart' | 'leaf' | 'users' | 'bell' | 'dot' | 'star' | 'flag';

export interface Category {
  id: string;
  name: string;
  /** Pastel surface colour (hex). Text colour is derived for contrast. */
  color: string;
  icon: CategoryIcon;
  isActive: boolean;
  builtIn: boolean;
  order: number;
}

export type CalendarView = 'month' | 'week' | 'day';
export type GanttZoom = 'day' | 'week' | 'month' | 'quarter';

export interface Settings {
  weekStartsOn: 0 | 1;
  defaultCalendarView: CalendarView;
  milestoneColor: string;
  completedColor: string;
  ganttZoom: GanttZoom;
  showBaseline: boolean;
  /** Gantt bar colouring: by phase (each phase its own colour) or by task category. */
  ganttColorBy: 'phase' | 'category';
  /** Linked scheduling: moving a task moves everything that depends on it. */
  autoSchedule: boolean;
  onboarded: boolean;
}

export interface PlannerData {
  tasks: Task[];
  projects: Project[];
  phases: Phase[];
  categories: Category[];
  settings: Settings;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
