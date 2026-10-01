import * as vscode from 'vscode';
import { formatDate, formatDay } from './format';
import { isOverdue, ProjectRef, Section, STATUS_LABELS, Task } from './model';
import { openProjects } from './project';
import { TaskStore } from './taskStore';

const NOTES_PREVIEW_LENGTH = 300;

export interface ProjectNode {
  kind: 'project';
  project: ProjectRef;
}

export interface SectionNode {
  kind: 'section';
  project: ProjectRef;
  section: Section;
}

/** The "Done" group, at the bottom of the list. */
export interface DoneGroupNode {
  kind: 'done';
  project: ProjectRef;
}

export interface TaskNode {
  kind: 'task';
  project: ProjectRef;
  task: Task;
}

export type TaskTreeNode = ProjectNode | SectionNode | DoneGroupNode | TaskNode;

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: TaskStore) {}

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getChildren(node?: TaskTreeNode): TaskTreeNode[] {
    if (!node) {
      const projects = openProjects();
      // A single open folder has no "project" level: its content sits at the root.
      return projects.length === 1
        ? this.contentOf(projects[0])
        : projects.map((project) => ({ kind: 'project', project }));
    }
    switch (node.kind) {
      case 'project':
        return this.contentOf(node.project);
      case 'section':
        return this.taskNodes(node.project, this.activeTasksIn(node.project, node.section.id));
      case 'done':
        return this.taskNodes(node.project, this.doneTasks(node.project));
      case 'task':
        return [];
    }
  }

  getTreeItem(node: TaskTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'project':
        return this.projectItem(node);
      case 'section':
        return this.sectionItem(node);
      case 'done':
        return this.doneGroupItem(node);
      case 'task':
        return this.taskItem(node);
    }
  }

  /** The sections, then the tasks outside any section, then the "Done" group. */
  private contentOf(project: ProjectRef): TaskTreeNode[] {
    const sections: TaskTreeNode[] = this.store
      .getSections(project.key)
      .map((section) => ({ kind: 'section', project, section }));
    const loose = this.taskNodes(project, this.activeTasksIn(project, undefined));
    const done: TaskTreeNode[] = this.doneTasks(project).length > 0 ? [{ kind: 'done', project }] : [];
    return [...sections, ...loose, ...done];
  }

  /** Unfinished tasks of a section, or outside any section if `sectionId` is absent. */
  private activeTasksIn(project: ProjectRef, sectionId: string | undefined): Task[] {
    // A task whose section was deleted elsewhere is shown outside any section.
    const sectionIds = new Set(this.store.getSections(project.key).map((s) => s.id));
    const sectionOf = (task: Task) => (task.sectionId && sectionIds.has(task.sectionId) ? task.sectionId : undefined);
    return this.store.getTasks(project.key).filter((t) => t.status !== 'done' && sectionOf(t) === sectionId);
  }

  /** Completed tasks, most recent first. */
  private doneTasks(project: ProjectRef): Task[] {
    return this.store
      .getTasks(project.key)
      .filter((t) => t.status === 'done')
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  }

  private taskNodes(project: ProjectRef, tasks: Task[]): TaskNode[] {
    return tasks.map((task) => ({ kind: 'task', project, task }));
  }

  private projectItem({ project }: ProjectNode): vscode.TreeItem {
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Expanded);
    const remaining = this.store.getTasks(project.key).filter((t) => t.status !== 'done').length;
    item.id = `${project.key}::project`;
    item.contextValue = 'project';
    item.iconPath = new vscode.ThemeIcon('root-folder');
    item.description = remaining > 0 ? `${remaining} remaining` : undefined;
    item.tooltip = project.key;
    return item;
  }

  private sectionItem({ project, section }: SectionNode): vscode.TreeItem {
    const count = this.activeTasksIn(project, section.id).length;
    const item = new vscode.TreeItem(
      section.name,
      count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `${project.key}::section::${section.id}`;
    item.contextValue = 'section';
    item.iconPath = new vscode.ThemeIcon('folder');
    item.description = String(count);
    return item;
  }

  private doneGroupItem({ project }: DoneGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(STATUS_LABELS.done, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `${project.key}::done`;
    item.contextValue = 'done-group';
    item.iconPath = new vscode.ThemeIcon('pass');
    item.description = String(this.doneTasks(project).length);
    return item;
  }

  private taskItem(node: TaskNode): vscode.TreeItem {
    const { project, task } = node;
    const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
    item.command = { command: 'taskPlanner.openTask', title: 'Open Task', arguments: [node] };
    item.id = `${project.key}::task::${task.id}`;
    item.contextValue = `task-${task.status}`;
    item.checkboxState =
      task.status === 'done' ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    const overdue = isOverdue(task);
    if (overdue) {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    } else if (task.status === 'doing') {
      item.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.blue'));
    }
    if (task.status === 'done') {
      item.description = task.completedAt && formatDate(task.completedAt);
    } else if (task.dueDate) {
      item.description = `due ${formatDay(task.dueDate)}`;
    }

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**').appendText(task.title).appendMarkdown('**\n\n');
    tooltip.appendText(`Status: ${STATUS_LABELS[task.status]}`).appendMarkdown('\n\n');
    tooltip.appendText(`Created ${formatDate(task.createdAt)}`);
    if (task.completedAt) {
      tooltip.appendMarkdown('\n\n').appendText(`Completed ${formatDate(task.completedAt)}`);
    }
    if (task.dueDate) {
      tooltip.appendMarkdown('\n\n').appendText(`Due ${formatDay(task.dueDate)}${overdue ? ' (overdue)' : ''}`);
    }
    if (task.notes) {
      const preview = task.notes.length > NOTES_PREVIEW_LENGTH ? `${task.notes.slice(0, NOTES_PREVIEW_LENGTH)}…` : task.notes;
      tooltip.appendMarkdown('\n\n---\n\n').appendText(preview);
    }
    item.tooltip = tooltip;
    return item;
  }
}
