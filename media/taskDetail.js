// @ts-check
// Task detail webview: title, due date, and notes (editable with the "Edit" button).
(function () {
  const SAVE_DELAY_MS = 400;

  // @ts-ignore — provided by VS Code in webviews
  const vscode = acquireVsCodeApi();
  const main = /** @type {HTMLElement} */ (document.getElementById('main'));
  const title = /** @type {HTMLElement} */ (document.getElementById('title'));
  const due = /** @type {HTMLInputElement} */ (document.getElementById('due'));
  const dueOverdue = /** @type {HTMLElement} */ (document.getElementById('due-overdue'));
  const editButton = /** @type {HTMLButtonElement} */ (document.getElementById('edit'));
  const editLabel = /** @type {HTMLElement} */ (document.getElementById('edit-label'));
  const notesView = /** @type {HTMLElement} */ (document.getElementById('notes-view'));
  const notes = /** @type {HTMLTextAreaElement} */ (document.getElementById('notes'));
  const saveStatus = /** @type {HTMLElement} */ (document.getElementById('save-status'));

  let initialized = false;
  let editing = false;
  /** Last notes confirmed by the extension. */
  let savedNotes = '';
  /** Last notes sent to the extension (or confirmed). */
  let sentNotes = '';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  function setStatus(text, isError = false) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle('error', isError);
  }

  function save() {
    clearTimeout(timer);
    timer = undefined;
    if (!initialized || notes.value === sentNotes) {
      return;
    }
    sentNotes = notes.value;
    vscode.postMessage({ type: 'saveNotes', notes: sentNotes });
  }

  function startEditing() {
    if (!initialized || editing) {
      return;
    }
    editing = true;
    main.classList.add('editing');
    editLabel.textContent = 'Done';
    notes.focus();
    notes.setSelectionRange(notes.value.length, notes.value.length);
  }

  function finishEditing() {
    if (!editing) {
      return;
    }
    save();
    editing = false;
    main.classList.remove('editing');
    editLabel.textContent = 'Edit';
    notesView.textContent = notes.value;
  }

  // "change" fires only once the date is complete, or cleared.
  due.addEventListener('change', () => {
    vscode.postMessage({ type: 'setDueDate', dueDate: due.value });
  });

  editButton.addEventListener('click', () => (editing ? finishEditing() : startEditing()));
  notesView.addEventListener('dblclick', startEditing);

  notes.addEventListener('input', () => {
    setStatus('Unsaved changes');
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  });
  notes.addEventListener('blur', save);
  notes.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing();
      editButton.focus();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener('blur', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      save();
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'update': {
        const task = message.task;
        title.textContent = task.title;
        if (document.activeElement !== due) {
          due.value = task.dueDate;
        }
        dueOverdue.hidden = !task.overdue;
        due.classList.toggle('overdue', task.overdue);
        // Notes coming from elsewhere (another window, an edited file) never replace text being typed.
        const idle = notes.value === savedNotes && sentNotes === savedNotes;
        if (!initialized || (idle && task.notes !== notes.value)) {
          notes.value = task.notes;
          savedNotes = sentNotes = task.notes;
          if (!editing) {
            notesView.textContent = task.notes;
          }
        }
        if (!initialized) {
          initialized = true;
          notes.disabled = false;
          due.disabled = false;
          editButton.disabled = false;
        }
        break;
      }
      case 'saved':
        savedNotes = message.notes;
        if (notes.value === savedNotes) {
          setStatus('Saved');
        }
        break;
      case 'saveFailed':
        // The next keystroke or loss of focus will retry the save.
        sentNotes = savedNotes;
        setStatus('Save failed', true);
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
