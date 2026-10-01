import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  Project,
  ProjectRef,
  Section,
  Task,
  TaskFile,
  TaskStatus,
  TASK_FILE_VERSION,
  emptyTaskFile,
  isDay,
  isTaskStatus,
} from './model';
import { moveSections, moveTasks, TaskDropTarget } from './reorder';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 10_000;

export interface TaskChanges {
  title?: string;
  status?: TaskStatus;
  notes?: string;
  /** Day in YYYY-MM-DD format; an empty string removes the due date. */
  dueDate?: string;
}

/** The tasks file cannot be read: every write is refused so it is never overwritten. */
export class TaskFileError extends Error {}

/**
 * Reads and writes tasks.json.
 *
 * Several VS Code windows share the same file: each change takes a lock,
 * re-reads the file, applies the change, then writes it atomically.
 */
export class TaskStore implements vscode.Disposable {
  private data: TaskFile = emptyTaskFile();
  private raw: string | undefined;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  /** Error from reading the file; while it is set, changes are blocked. */
  error: TaskFileError | undefined;

  readonly onDidChange = this.changeEmitter.event;

  constructor(readonly filePath: string) {}

  dispose(): void {
    this.changeEmitter.dispose();
  }

  /** Re-reads the file; `onDidChange` fires only if its contents changed. */
  load(): Promise<void> {
    return this.enqueue(() => this.readFromDisk());
  }

  /** Creates the file if it does not exist yet. */
  ensureFile(): Promise<void> {
    return this.enqueue(() =>
      this.withFileLock(async () => {
        await this.readFromDisk();
        if (this.raw === undefined) {
          await this.writeToDisk(emptyTaskFile());
        }
      }),
    );
  }

  getTasks(key: string): readonly Task[] {
    return this.data.projects[key]?.tasks ?? [];
  }

  getSections(key: string): readonly Section[] {
    return this.data.projects[key]?.sections ?? [];
  }

  addTask(project: ProjectRef, title: string, sectionId?: string): Promise<Task> {
    return this.mutate((data) => {
      const now = new Date().toISOString();
      const task: Task = { id: randomUUID(), title, status: 'todo', createdAt: now, updatedAt: now };
      if (sectionId !== undefined) {
        task.sectionId = sectionId;
      }
      projectIn(data, project).tasks.push(task);
      return task;
    });
  }

  addSection(project: ProjectRef, name: string): Promise<Section> {
    return this.mutate((data) => {
      const section: Section = { id: randomUUID(), name };
      const p = projectIn(data, project);
      p.sections = [...(p.sections ?? []), section];
      return section;
    });
  }

  renameSection(project: ProjectRef, id: string, name: string): Promise<void> {
    return this.mutate((data) => {
      const section = projectIn(data, project).sections?.find((s) => s.id === id);
      if (section) {
        section.name = name;
      }
    });
  }

  /** Deletes a section; its tasks are kept and moved out of it. */
  deleteSection(project: ProjectRef, id: string): Promise<void> {
    return this.mutate((data) => {
      const p = projectIn(data, project);
      p.sections = p.sections?.filter((s) => s.id !== id);
      for (const task of p.tasks.filter((t) => t.sectionId === id)) {
        delete task.sectionId;
      }
    });
  }

  moveTasks(project: ProjectRef, ids: readonly string[], target: TaskDropTarget): Promise<void> {
    return this.mutate((data) => moveTasks(projectIn(data, project), ids, target, new Date().toISOString()));
  }

  /** Moves sections to the place of `anchorId`, or to the end if it is absent. */
  moveSections(project: ProjectRef, ids: readonly string[], anchorId: string | undefined): Promise<void> {
    return this.mutate((data) => moveSections(projectIn(data, project), ids, anchorId));
  }

  updateTask(project: ProjectRef, id: string, changes: TaskChanges): Promise<void> {
    return this.mutate((data) => {
      const task = projectIn(data, project).tasks.find((t) => t.id === id);
      if (!task) {
        return;
      }
      const now = new Date().toISOString();
      if (changes.title !== undefined) {
        task.title = changes.title;
      }
      // An empty string removes the field from the file.
      for (const field of ['notes', 'dueDate'] as const) {
        const value = changes[field];
        if (value === '') {
          delete task[field];
        } else if (value !== undefined) {
          task[field] = value;
        }
      }
      if (changes.status !== undefined && changes.status !== task.status) {
        task.status = changes.status;
        if (changes.status === 'done') {
          task.completedAt = now;
        } else {
          delete task.completedAt;
        }
      }
      task.updatedAt = now;
    });
  }

  deleteTask(project: ProjectRef, id: string): Promise<void> {
    return this.mutate((data) => {
      const p = projectIn(data, project);
      p.tasks = p.tasks.filter((t) => t.id !== id);
    });
  }

  /** Deletes the completed tasks of the given projects and returns how many were deleted. */
  clearCompleted(projects: readonly ProjectRef[]): Promise<number> {
    return this.mutate((data) => {
      let removed = 0;
      for (const project of projects) {
        const p = projectIn(data, project);
        const remaining = p.tasks.filter((t) => t.status !== 'done');
        removed += p.tasks.length - remaining.length;
        p.tasks = remaining;
      }
      return removed;
    });
  }

  private mutate<T>(apply: (data: TaskFile) => T): Promise<T> {
    return this.enqueue(() =>
      this.withFileLock(async () => {
        await this.readFromDisk();
        if (this.error) {
          throw this.error;
        }
        const data = structuredClone(this.data);
        const result = apply(data);
        for (const [key, project] of Object.entries(data.projects)) {
          if (project.sections?.length === 0) {
            delete project.sections;
          }
          if (project.tasks.length === 0 && !project.sections) {
            delete data.projects[key];
          }
        }
        await this.writeToDisk(data);
        return result;
      }),
    );
  }

  private async readFromDisk(): Promise<void> {
    const raw = await readFileIfExists(this.filePath);
    if (this.loaded && raw === this.raw) {
      return;
    }
    this.loaded = true;
    this.raw = raw;
    try {
      this.data = raw === undefined || raw.trim() === '' ? emptyTaskFile() : parseTaskFile(raw);
      this.error = undefined;
    } catch (err) {
      // Keep showing the last valid data, but stop writing anything.
      this.error = new TaskFileError(`The tasks file is invalid (${errorMessage(err)}).`);
    }
    this.changeEmitter.fire();
  }

  private async writeToDisk(data: TaskFile): Promise<void> {
    const raw = JSON.stringify(data, null, 2) + '\n';
    const tmpPath = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmpPath, raw, 'utf8');
    await fs.rename(tmpPath, this.filePath);
    this.data = data;
    this.raw = raw;
    this.loaded = true;
    this.changeEmitter.fire();
  }

  /** Cross-window lock: a `.lock` file created exclusively. */
  private async withFileLock<T>(action: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    for (;;) {
      try {
        await (await fs.open(lockPath, 'wx')).close();
        break;
      } catch (err) {
        if (!isErrnoException(err, 'EEXIST')) {
          throw err;
        }
      }
      // A stale lock comes from a window that stopped in the middle of a write.
      const stat = await fs.stat(lockPath).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('The tasks file is locked by another window. Try again in a moment.');
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    try {
      return await action();
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function projectIn(data: TaskFile, ref: ProjectRef): Project {
  const project = (data.projects[ref.key] ??= { name: ref.name, tasks: [] });
  project.name = ref.name;
  return project;
}

function parseTaskFile(raw: string): TaskFile {
  const json: unknown = JSON.parse(raw);
  if (!isRecord(json) || !isRecord(json.projects)) {
    throw new Error('missing "projects" property');
  }
  if (typeof json.version !== 'number' || json.version > TASK_FILE_VERSION) {
    throw new Error(`unsupported version ${String(json.version)}`);
  }
  for (const [key, project] of Object.entries(json.projects)) {
    if (!isRecord(project) || !Array.isArray(project.tasks)) {
      throw new Error(`project "${key}" has no "tasks" list`);
    }
    if (
      project.sections !== undefined &&
      (!Array.isArray(project.sections) ||
        !project.sections.every((s) => isRecord(s) && typeof s.id === 'string' && typeof s.name === 'string'))
    ) {
      throw new Error(`invalid sections in "${key}"`);
    }
    for (const task of project.tasks) {
      if (
        !isRecord(task) ||
        typeof task.id !== 'string' ||
        typeof task.title !== 'string' ||
        !isTaskStatus(task.status) ||
        (task.notes !== undefined && typeof task.notes !== 'string') ||
        (task.dueDate !== undefined && !isDay(task.dueDate)) ||
        (task.sectionId !== undefined && typeof task.sectionId !== 'string')
      ) {
        throw new Error(`invalid task in "${key}"`);
      }
    }
  }
  return json as unknown as TaskFile;
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return undefined;
    }
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrnoException(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
