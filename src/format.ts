import * as vscode from 'vscode';

/** Short date in the VS Code display language, for example "Oct 1, 2026". */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatLocalDate(date);
}

/** A YYYY-MM-DD day, read in local time (`new Date('2026-10-03')` would read it as UTC). */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return formatLocalDate(new Date(year, month - 1, date));
}

function formatLocalDate(date: Date): string {
  return date.toLocaleDateString(vscode.env.language, { day: 'numeric', month: 'short', year: 'numeric' });
}
