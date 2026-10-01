# Task Planner

A simple task list for each of your projects, right in the VS Code sidebar.

## Features

- **One list per project**: each open folder has its own tasks.
- **Statuses**: To Do, In Progress, Done. Check a task to complete it.
- **Sections**: group related tasks together.
- **Notes and due dates**: click a task to add notes and a due date. Overdue tasks show a ⚠ icon.
- **Outside your repo**: tasks are saved in your VS Code user profile, never in the project.

## Shortcuts

| Key | Action |
| --- | --- |
| `F2` | Rename the selected task or section |
| `Delete` (`Cmd+Backspace` on macOS) | Delete the selected task or section |

## Storage

Tasks are stored in a single `tasks.json` file. Open it with **Task Planner: Open Tasks File**.

Projects are identified by their folder path: if you move or rename a folder, its tasks stay under the old path.
