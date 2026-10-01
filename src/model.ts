export type TaskStatus = 'todo' | 'doing' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  doing: 'In Progress',
  done: 'Done',
};

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** Free-form summary or notes, entered in the detail view. */
  notes?: string;
  /** Due date in YYYY-MM-DD format. */
  dueDate?: string;
  /** Section the task belongs to; when absent, the task is outside any section. */
  sectionId?: string;
}

export interface Section {
  id: string;
  name: string;
}

export interface Project {
  /** Folder name, to keep the JSON file readable. */
  name: string;
  /** Sections, in display order. */
  sections?: Section[];
  /** Tasks, in display order. */
  tasks: Task[];
}

/** Contents of tasks.json: the tasks of every project, keyed by project key. */
export interface TaskFile {
  version: number;
  projects: Record<string, Project>;
}

/** A project open in the current window. */
export interface ProjectRef {
  key: string;
  name: string;
}

export const TASK_FILE_NAME = 'tasks.json';
export const TASK_FILE_VERSION = 1;

export function emptyTaskFile(): TaskFile {
  return { version: TASK_FILE_VERSION, projects: {} };
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

/** True for a day in YYYY-MM-DD format. */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Local day in YYYY-MM-DD format; two days compare correctly as strings. */
export function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** An unfinished task whose due day has passed. */
export function isOverdue(task: Task, now = new Date()): boolean {
  return task.status !== 'done' && task.dueDate !== undefined && task.dueDate < toDay(now);
}
