import * as vscode from 'vscode';
import { TaskFileError, TaskStore } from './taskStore';

/** Shows an error; if the file is invalid, offers to open it so it can be fixed. */
export async function showError(store: TaskStore, err: unknown): Promise<void> {
  if (err instanceof TaskFileError) {
    const action = await vscode.window.showErrorMessage(
      `${err.message} Fix it to be able to edit your tasks.`,
      'Open File',
    );
    if (action) {
      await vscode.window.showTextDocument(vscode.Uri.file(store.filePath));
    }
    return;
  }
  vscode.window.showErrorMessage(`Task Planner: ${err instanceof Error ? err.message : String(err)}`);
}
