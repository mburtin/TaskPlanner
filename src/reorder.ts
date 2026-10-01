import { Project } from './model';

/** Where tasks dragged in the sidebar are dropped. */
export type TaskDropTarget =
  /** At the end of a section, or of the tasks outside any section if `sectionId` is absent. */
  | { kind: 'section'; sectionId?: string }
  /** In place of another task, in its section. */
  | { kind: 'task'; taskId: string }
  /** In the "Done" group. */
  | { kind: 'done' };

/**
 * Moves tasks. Dropping them in "Done" completes them; moving them out of it reopens them.
 * A task dropped on another takes its place: after it if it came from above, before it otherwise.
 */
export function moveTasks(project: Project, ids: readonly string[], target: TaskDropTarget, now: string): void {
  const moving = project.tasks.filter((t) => ids.includes(t.id));
  const anchor = target.kind === 'task' ? project.tasks.find((t) => t.id === target.taskId) : undefined;
  if (moving.length === 0 || (target.kind === 'task' && (!anchor || moving.includes(anchor)))) {
    return;
  }

  if (target.kind === 'done' || anchor?.status === 'done') {
    for (const task of moving.filter((t) => t.status !== 'done')) {
      task.status = 'done';
      task.completedAt = now;
      task.updatedAt = now;
    }
    return;
  }

  const sectionId = anchor ? anchor.sectionId : target.kind === 'section' ? target.sectionId : undefined;
  const after =
    anchor !== undefined &&
    moving[0].sectionId === anchor.sectionId &&
    project.tasks.indexOf(moving[0]) < project.tasks.indexOf(anchor);

  for (const task of moving) {
    if (sectionId === undefined) {
      delete task.sectionId;
    } else {
      task.sectionId = sectionId;
    }
    if (task.status === 'done') {
      task.status = 'todo';
      delete task.completedAt;
    }
    task.updatedAt = now;
  }

  project.tasks = insertAt(project.tasks, moving, anchor, after);
}

/** Moves sections to the place of `anchorId`, or to the end if it is absent. */
export function moveSections(project: Project, ids: readonly string[], anchorId: string | undefined): void {
  const sections = project.sections ?? [];
  const moving = sections.filter((s) => ids.includes(s.id));
  const anchor = sections.find((s) => s.id === anchorId);
  if (moving.length === 0 || (anchor && moving.includes(anchor))) {
    return;
  }
  const after = anchor !== undefined && sections.indexOf(moving[0]) < sections.indexOf(anchor);
  project.sections = insertAt(sections, moving, anchor, after);
}

/** Removes `moving` from `items`, then inserts it before or after `anchor`, or at the end. */
function insertAt<T>(items: readonly T[], moving: readonly T[], anchor: T | undefined, after: boolean): T[] {
  const rest = items.filter((item) => !moving.includes(item));
  const index = anchor === undefined ? rest.length : rest.indexOf(anchor) + (after ? 1 : 0);
  rest.splice(index, 0, ...moving);
  return rest;
}
