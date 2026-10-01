import * as vscode from 'vscode';
import { showError } from './errors';
import { ProjectRef, TaskStatus } from './model';
import { openProjects } from './project';
import { TaskDetailPanel } from './taskDetailPanel';
import { TaskStore } from './taskStore';
import { TaskNode, TaskTreeNode } from './taskTreeProvider';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: TaskStore,
  treeView: vscode.TreeView<TaskTreeNode>,
): void {
  const register = (id: string, handler: (node?: TaskTreeNode) => Promise<unknown>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (node?: TaskTreeNode) => handler(node).catch((err) => showError(store, err))),
    );
  };

  // A keyboard shortcut passes no node: use the selection instead.
  const taskFrom = (node?: TaskTreeNode): TaskNode | undefined => {
    const target = node ?? treeView.selection[0];
    return target?.kind === 'task' ? target : undefined;
  };

  const markAs = (status: TaskStatus) => async (node?: TaskTreeNode) => {
    const target = taskFrom(node);
    if (target) {
      await store.updateTask(target.project, target.task.id, { status });
    }
  };

  register('taskPlanner.addTask', async (node) => {
    const project = node?.project ?? (await pickProject());
    if (!project) {
      return;
    }
    const section = node?.kind === 'section' ? node.section : undefined;
    const title = await vscode.window.showInputBox({
      title: `New Task — ${section?.name ?? project.name}`,
      placeHolder: 'Task title',
      validateInput: validateTitle,
    });
    if (title !== undefined) {
      await store.addTask(project, title.trim(), section?.id);
    }
  });

  register('taskPlanner.addSection', async (node) => {
    const project = node?.project ?? (await pickProject());
    if (!project) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: `New Section — ${project.name}`,
      placeHolder: 'Section name',
      validateInput: validateName,
    });
    if (name !== undefined) {
      await store.addSection(project, name.trim());
    }
  });

  register('taskPlanner.openTask', async (node) => {
    const target = taskFrom(node);
    if (target) {
      TaskDetailPanel.show(context.extensionUri, store, target.project, target.task.id);
    }
  });

  // Rename and Delete apply to a task or a section, so both share F2 and Delete.
  register('taskPlanner.rename', async (node) => {
    const target = node ?? treeView.selection[0];
    if (target?.kind === 'task') {
      const title = await vscode.window.showInputBox({
        title: 'Rename Task',
        value: target.task.title,
        validateInput: validateTitle,
      });
      if (title !== undefined && title.trim() !== target.task.title) {
        await store.updateTask(target.project, target.task.id, { title: title.trim() });
      }
    } else if (target?.kind === 'section') {
      const name = await vscode.window.showInputBox({
        title: 'Rename Section',
        value: target.section.name,
        validateInput: validateName,
      });
      if (name !== undefined && name.trim() !== target.section.name) {
        await store.renameSection(target.project, target.section.id, name.trim());
      }
    }
  });

  register('taskPlanner.delete', async (node) => {
    const target = node ?? treeView.selection[0];
    if (target?.kind === 'task') {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete the task "${target.task.title}"?`,
        { modal: true },
        'Delete',
      );
      if (confirmed) {
        await store.deleteTask(target.project, target.task.id);
      }
    } else if (target?.kind === 'section') {
      const count = store.getTasks(target.project.key).filter((t) => t.sectionId === target.section.id).length;
      const confirmed = await vscode.window.showWarningMessage(
        `Delete the section "${target.section.name}"?`,
        {
          modal: true,
          detail:
            count === 0
              ? undefined
              : count === 1
                ? 'Its task will be kept and moved out of the section.'
                : `Its ${count} tasks will be kept and moved out of the section.`,
        },
        'Delete',
      );
      if (confirmed) {
        await store.deleteSection(target.project, target.section.id);
      }
    }
  });

  register('taskPlanner.markTodo', markAs('todo'));
  register('taskPlanner.markDoing', markAs('doing'));
  register('taskPlanner.markDone', markAs('done'));

  register('taskPlanner.clearCompleted', async () => {
    const projects = openProjects();
    const count = projects.reduce(
      (sum, project) => sum + store.getTasks(project.key).filter((t) => t.status === 'done').length,
      0,
    );
    if (count === 0) {
      vscode.window.showInformationMessage('There are no completed tasks to delete.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      count === 1 ? 'Delete the completed task?' : `Delete the ${count} completed tasks?`,
      { modal: true },
      'Delete',
    );
    if (confirmed) {
      await store.clearCompleted(projects);
    }
  });

  register('taskPlanner.openStorageFile', () => openStorageFile(store));

  register('taskPlanner.refresh', () => store.load());
}

export async function openStorageFile(store: TaskStore): Promise<void> {
  await store.ensureFile();
  await vscode.window.showTextDocument(vscode.Uri.file(store.filePath));
}

async function pickProject(): Promise<ProjectRef | undefined> {
  const projects = openProjects();
  if (projects.length === 0) {
    vscode.window.showInformationMessage('Open a folder to manage its tasks.');
    return undefined;
  }
  if (projects.length === 1) {
    return projects[0];
  }
  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({ label: project.name, description: project.key, project })),
    { title: 'Select a Project' },
  );
  return picked?.project;
}

function validateTitle(value: string): string | undefined {
  return value.trim() === '' ? 'The title cannot be empty.' : undefined;
}

function validateName(value: string): string | undefined {
  return value.trim() === '' ? 'The name cannot be empty.' : undefined;
}
