import * as vscode from 'vscode';
import { ProjectRef } from './model';

/**
 * Key of a project in tasks.json: the path of its root folder.
 * Remote folders keep their full URI so they never collide with a local path.
 */
export function projectKey(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

/** The projects open in the window: one per workspace root folder. */
export function openProjects(): ProjectRef[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    key: projectKey(folder.uri),
    name: folder.name,
  }));
}
