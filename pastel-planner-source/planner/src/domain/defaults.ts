import type { Category, PlannerData, Settings } from './types';

/** Soft pastel design palette (also exposed as CSS variables in tokens.css). */
export const PALETTE = {
  pink: '#F7DCE5', // Personal
  blue: '#D9E8FC', // Work & projects
  sage: '#D8EFE4', // Daily routines & completed
  lavender: '#E9DDF9', // Meetings & appointments
  butter: '#F9E8C9', // Deadlines & milestones
  peach: '#F8D9CF', // Important reminders
  gray: '#E8E6E3', // Other
};

/** Phase colours cycle through the pastel palette in phase order. */
export const PHASE_PALETTE = [PALETTE.blue, PALETTE.pink, PALETTE.sage, PALETTE.lavender, PALETTE.butter, PALETTE.peach];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'work', name: 'Work', color: PALETTE.blue, icon: 'briefcase', isActive: true, builtIn: true, order: 0 },
  { id: 'personal', name: 'Personal', color: PALETTE.pink, icon: 'heart', isActive: true, builtIn: true, order: 1 },
  { id: 'daily', name: 'Daily routine', color: PALETTE.sage, icon: 'leaf', isActive: true, builtIn: true, order: 2 },
  { id: 'meeting', name: 'Meeting / Event', color: PALETTE.lavender, icon: 'users', isActive: true, builtIn: true, order: 3 },
  { id: 'reminder', name: 'Important reminder', color: PALETTE.peach, icon: 'bell', isActive: true, builtIn: true, order: 4 },
  { id: 'other', name: 'Other', color: PALETTE.gray, icon: 'dot', isActive: true, builtIn: true, order: 5 },
];

export const DEFAULT_SETTINGS: Settings = {
  weekStartsOn: 0,
  defaultCalendarView: 'month',
  milestoneColor: PALETTE.butter,
  completedColor: PALETTE.sage,
  ganttZoom: 'day',
  showBaseline: false,
  ganttColorBy: 'phase',
  autoSchedule: true,
  onboarded: false,
};

export function emptyData(): PlannerData {
  return {
    tasks: [],
    projects: [],
    phases: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...DEFAULT_SETTINGS },
  };
}
