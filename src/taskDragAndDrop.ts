import * as vscode from 'vscode';
import { showError } from './errors';
import { openProjects } from './project';
import { TaskDropTarget } from './reorder';
import { TaskStore } from './taskStore';
import { SectionNode, TaskNode, TaskTreeNode } from './taskTreeProvider';

/** Type of the dragged data: `application/vnd.code.tree.` followed by the view id in lowercase. */
const MIME_TYPE = 'application/vnd.code.tree.taskplanner.tasks';

/** Drag and drop of tasks and sections in the sidebar. */
export class TaskDragAndDropController implements vscode.TreeDragAndDropController<TaskTreeNode> {
  readonly dragMimeTypes = [MIME_TYPE];
  readonly dropMimeTypes = [MIME_TYPE];

  constructor(private readonly store: TaskStore) {}

  handleDrag(source: readonly TaskTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const draggable = source.filter((node) => node.kind === 'task' || node.kind === 'section');
    if (draggable.length > 0) {
      dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(draggable));
    }
  }

  async handleDrop(target: TaskTreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dragged = dataTransfer.get(MIME_TYPE)?.value as TaskTreeNode[] | undefined;
    // Dropped on empty space: the project is known only when a single folder is open.
    const projects = openProjects();
    const project = target?.project ?? (projects.length === 1 ? projects[0] : undefined);
    if (!dragged || !project) {
      return;
    }
    // Nothing moves from one project to another.
    const sameProject = dragged.filter((node) => node.project.key === project.key);
    const taskIds = sameProject.filter((n): n is TaskNode => n.kind === 'task').map((n) => n.task.id);
    const sectionIds = sameProject.filter((n): n is SectionNode => n.kind === 'section').map((n) => n.section.id);
    try {
      if (sectionIds.length > 0) {
        await this.store.moveSections(project, sectionIds, sectionAnchor(target));
      }
      if (taskIds.length > 0) {
        await this.store.moveTasks(project, taskIds, taskTarget(target));
      }
    } catch (err) {
      await showError(this.store, err);
    }
  }
}

function taskTarget(target: TaskTreeNode | undefined): TaskDropTarget {
  switch (target?.kind) {
    case 'section':
      return { kind: 'section', sectionId: target.section.id };
    case 'task':
      return { kind: 'task', taskId: target.task.id };
    case 'done':
      return { kind: 'done' };
    default:
      // On the project or on empty space: outside any section.
      return { kind: 'section' };
  }
}

/** Section whose place the dropped sections take; none to put them at the end. */
function sectionAnchor(target: TaskTreeNode | undefined): string | undefined {
  if (target?.kind === 'section') {
    return target.section.id;
  }
  if (target?.kind === 'task' && target.task.status !== 'done') {
    return target.task.sectionId;
  }
  return undefined;
}
