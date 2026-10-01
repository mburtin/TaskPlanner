import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { showError } from './errors';
import { isDay, isOverdue, ProjectRef, Task } from './model';
import { TaskStore } from './taskStore';

/** Messages sent by the webview script (media/taskDetail.js). */
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'saveNotes'; notes: string }
  | { type: 'setDueDate'; dueDate: string };

/** Detail tab of a task: its title, its due date, and a notes area that saves automatically. */
export class TaskDetailPanel {
  private static readonly panels = new Map<string, TaskDetailPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  /** Re-sends the state of every open tab, for example when a due date becomes overdue. */
  static refreshAll(): void {
    TaskDetailPanel.panels.forEach((panel) => panel.sync());
  }

  /** Opens the task's tab, or brings it to the front if it is already open. */
  static show(extensionUri: vscode.Uri, store: TaskStore, project: ProjectRef, taskId: string): void {
    const id = `${project.key}::${taskId}`;
    const existing = TaskDetailPanel.panels.get(id);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const task = store.getTasks(project.key).find((t) => t.id === taskId);
    if (!task) {
      return;
    }
    const mediaUri = vscode.Uri.joinPath(extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('taskPlanner.taskDetail', task.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [mediaUri],
      // Keeps text being typed when the tab goes to the background.
      retainContextWhenHidden: true,
    });
    TaskDetailPanel.panels.set(id, new TaskDetailPanel(id, panel, mediaUri, store, project, taskId));
  }

  private constructor(
    private readonly id: string,
    private readonly panel: vscode.WebviewPanel,
    mediaUri: vscode.Uri,
    private readonly store: TaskStore,
    private readonly project: ProjectRef,
    private readonly taskId: string,
  ) {
    panel.webview.html = renderHtml(panel.webview, mediaUri);
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message)),
      store.onDidChange(() => this.sync()),
    );
  }

  private get task(): Task | undefined {
    return this.store.getTasks(this.project.key).find((t) => t.id === this.taskId);
  }

  /** Sends the task's state to the webview; closes the tab if the task was deleted. */
  private sync(): void {
    const task = this.task;
    if (!task) {
      this.panel.dispose();
      return;
    }
    this.panel.title = task.title;
    void this.panel.webview.postMessage({
      type: 'update',
      task: {
        title: task.title,
        notes: task.notes ?? '',
        dueDate: task.dueDate ?? '',
        overdue: isOverdue(task),
      },
    });
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.sync();
        break;
      case 'saveNotes':
        try {
          await this.store.updateTask(this.project, this.taskId, { notes: message.notes });
          void this.panel.webview.postMessage({ type: 'saved', notes: message.notes });
        } catch (err) {
          void this.panel.webview.postMessage({ type: 'saveFailed' });
          await showError(this.store, err);
        }
        break;
      case 'setDueDate':
        if (message.dueDate !== '' && !isDay(message.dueDate)) {
          return;
        }
        try {
          await this.store.updateTask(this.project, this.taskId, { dueDate: message.dueDate });
        } catch (err) {
          this.sync(); // puts the previous due date back in the field
          await showError(this.store, err);
        }
        break;
    }
  }

  private dispose(): void {
    TaskDetailPanel.panels.delete(this.id);
    this.disposables.forEach((d) => d.dispose());
  }
}

function renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
  const nonce = randomUUID().replace(/-/g, '');
  const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, file)).toString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${media('taskDetail.css')}">
  <title>Task</title>
</head>
<body>
  <main id="main">
    <h1 id="title"></h1>
    <div class="due-row">
      <label for="due">Due date</label>
      <input id="due" type="date" disabled>
      <span id="due-overdue" class="due-overdue" hidden>Overdue</span>
    </div>
    <div class="notes-header">
      <h2 id="notes-label">Notes</h2>
      <button id="edit" class="edit-button" type="button" disabled>
        <svg class="icon icon-edit" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z M9 4l3 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        <svg class="icon icon-done" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span id="edit-label">Edit</span>
      </button>
    </div>
    <div id="notes-view" class="notes-view" data-placeholder="No notes."></div>
    <textarea id="notes" aria-labelledby="notes-label" placeholder="Summary, notes, links…" disabled></textarea>
    <p id="save-status" class="save-status" aria-live="polite"></p>
  </main>
  <script nonce="${nonce}" src="${media('taskDetail.js')}"></script>
</body>
</html>`;
}
