import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { showError } from './errors';
import { TASK_FILE_NAME, toDay } from './model';
import { openProjects } from './project';
import { TaskDetailPanel } from './taskDetailPanel';
import { TaskDragAndDropController } from './taskDragAndDrop';
import { TaskStore } from './taskStore';
import { TaskTreeNode, TaskTreeProvider } from './taskTreeProvider';

const DAY_CHECK_INTERVAL_MS = 60_000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  const store = new TaskStore(vscode.Uri.joinPath(context.globalStorageUri, TASK_FILE_NAME).fsPath);
  const provider = new TaskTreeProvider(store);
  const treeView = vscode.window.createTreeView<TaskTreeNode>('taskPlanner.tasks', {
    treeDataProvider: provider,
    dragAndDropController: new TaskDragAndDropController(store),
    manageCheckboxStateManually: true,
  });
  context.subscriptions.push(store, provider, treeView);

  const update = () => {
    provider.refresh();
    const remaining = openProjects().reduce(
      (sum, project) => sum + store.getTasks(project.key).filter((t) => t.status !== 'done').length,
      0,
    );
    treeView.badge =
      remaining > 0
        ? { value: remaining, tooltip: `${remaining} open task${remaining > 1 ? 's' : ''}` }
        : undefined;
  };

  // Reports each new file read error only once.
  let reportedError: string | undefined;
  const reportFileError = () => {
    if (store.error && store.error.message !== reportedError) {
      void showError(store, store.error);
    }
    reportedError = store.error?.message;
  };

  const reload = () => store.load().catch((err) => showError(store, err));

  // The file is shared with other windows and can be edited by hand.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(context.globalStorageUri, TASK_FILE_NAME),
  );

  context.subscriptions.push(
    store.onDidChange(() => {
      update();
      reportFileError();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(update),
    treeView.onDidChangeCheckboxState((event) => {
      for (const [node, state] of event.items) {
        if (node.kind === 'task') {
          const status = state === vscode.TreeItemCheckboxState.Checked ? 'done' : 'todo';
          store.updateTask(node.project, node.task.id, { status }).catch((err) => {
            update(); // restores the checkbox to its actual state
            return showError(store, err);
          });
        }
      }
    }),
    watcher,
    watcher.onDidCreate(reload),
    watcher.onDidChange(reload),
    watcher.onDidDelete(reload),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        reload();
      }
    }),
  );

  // When the day changes, due dates become overdue without the file changing.
  let today = toDay(new Date());
  const dayCheck = setInterval(() => {
    if (toDay(new Date()) !== today) {
      today = toDay(new Date());
      update();
      TaskDetailPanel.refreshAll();
    }
  }, DAY_CHECK_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(dayCheck) });

  registerCommands(context, store, treeView);

  await reload();
  update();
}

export function deactivate(): void {}
