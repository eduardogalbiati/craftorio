// src/renderer/kept-work-dialog.js: the confirm modal's named-choice variant (#170),
// choiceDialog, and the kept-work question it serves, keptWorkDialog ($, esc, openModal,
// closeModal and confirmDialog come from src/renderer/app.js, which the dialog file relies on).
// Pure DOM glue, no main-process calls, so it is pulled out of the source and run in a vm sandbox
// against a minimal fake DOM, the way test/renderer-run-view.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const dialogSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'kept-work-dialog.js'), 'utf8');

// A minimal element: classList (add/remove/toggle/contains), dataset, textContent, and an innerHTML
// that fakes just enough of the DOM to make `children.length` reflect the <li> tags written to it
// (choiceDialog's only use of `children`).
function makeEl() {
  const classes = new Set();
  const el = {
    textContent: '',
    dataset: {},
    onclick: null,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
    get children() { return this._children || []; },
    before() { /* ordering of modal-actions buttons is not asserted */ },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) { this._html = v; this._children = (v.match(/<li/g) || []).map(() => ({})); },
  });
  return el;
}

// Loads openModal/closeModal/confirmDialog/choiceDialog/keptWorkDialog with a fake document: the
// fixed elements the modal needs, plus createElement for the per-choice buttons (tracked in
// `buttons`, in creation order, so a test can inspect what was added and removed).
function loadDialogs() {
  const ids = ['#confirm-title', '#confirm-message', '#confirm-details', '#btn-confirm-yes', '#btn-confirm-no', '#confirm-modal'];
  const els = new Map(ids.map((id) => [id, makeEl()]));
  const buttons = [];
  const resumeCalls = [];
  const sandbox = {
    document: {
      querySelector: (sel) => els.get(sel) || null,
      createElement: () => {
        const b = makeEl();
        b.remove = () => { const i = buttons.indexOf(b); if (i >= 0) buttons.splice(i, 1); };
        buttons.push(b);
        return b;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.window.openResumeDialog = (runId) => resumeCalls.push(runId);
  vm.createContext(sandbox);
  const dollar = /const \$ = \(sel\) => document\.querySelector\(sel\);/.exec(src)[0];
  const openModal = /function openModal\(sel\) \{[^\n]*\}/.exec(src)[0];
  const closeModal = /function closeModal\(sel\) \{[^\n]*\}/.exec(src)[0];
  const esc = /const esc = \(s\) => [^\n]+;/.exec(src)[0];
  const confirmDialog = /function confirmDialog\(title, message, yes = 'Confirm'\) \{[\s\S]*?\n\}/.exec(src)[0];
  for (const [name, code] of Object.entries({ dollar, openModal, closeModal, esc, confirmDialog })) {
    assert.ok(code, `${name} not found in app.js: the source moved`);
  }
  const choiceDialog = /function choiceDialog\(title, message, choices\) \{[\s\S]*?\n\}/.exec(dialogSrc)[0];
  const keptWorkDialog = /async function keptWorkDialog\(kept\) \{[\s\S]*?\n\}/.exec(dialogSrc)[0];
  for (const [name, code] of Object.entries({ choiceDialog, keptWorkDialog })) {
    assert.ok(code, `${name} not found in kept-work-dialog.js: the source moved`);
  }
  vm.runInContext(
    `${dollar}\n${esc}\n${openModal}\n${closeModal}\n${confirmDialog}\n${choiceDialog}\n${keptWorkDialog}\n`
    + 'this.dialogs = { confirmDialog, choiceDialog, keptWorkDialog };',
    sandbox,
  );
  return { dialogs: sandbox.dialogs, els, buttons, resumeCalls, modal: els.get('#confirm-modal') };
}

const CHOICES = [
  { id: 'resume', label: 'Resume the old run', line: 'Resume the old run: continues from those commits.', primary: false },
  { id: 'scratch', label: 'Start from scratch', line: 'Start from scratch: a new run.', primary: true },
];

test('confirmDialog: hides #confirm-details (a plain yes/no question has no choice lines)', async () => {
  const { dialogs, els } = loadDialogs();
  const p = dialogs.confirmDialog('Clear the roadmap', 'Every stage is removed.', 'Clear');
  assert.equal(els.get('#confirm-details').classList.contains('hidden'), true);
  els.get('#btn-confirm-no').onclick();
  assert.equal(await p, false);
});

test('choiceDialog: renders one button per choice (primary gets "btn primary", others "btn ghost"), lists each choice\'s line, and hides the plain yes button while open', async () => {
  const { dialogs, els, buttons } = loadDialogs();
  const p = dialogs.choiceDialog('Title', 'Message', CHOICES);
  assert.equal(els.get('#confirm-title').textContent, 'Title');
  assert.equal(els.get('#confirm-message').textContent, 'Message');
  assert.equal(els.get('#btn-confirm-yes').classList.contains('hidden'), true);
  assert.equal(els.get('#confirm-details').classList.contains('hidden'), false);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].className, 'btn ghost');
  assert.equal(buttons[0].textContent, 'Resume the old run');
  assert.equal(buttons[0].dataset.choice, 'resume');
  assert.equal(buttons[1].className, 'btn primary');
  assert.equal(buttons[1].textContent, 'Start from scratch');
  assert.equal(buttons[1].dataset.choice, 'scratch');

  buttons[1].onclick();
  assert.equal(await p, 'scratch');
  assert.equal(els.get('#btn-confirm-yes').classList.contains('hidden'), false, 'restored after the dialog closes');
  assert.equal(buttons.length, 0, 'the choice buttons are removed once answered');
});

test('choiceDialog: a choice with no `line` is not listed, so #confirm-details stays hidden when none has one', async () => {
  const { dialogs, els, buttons } = loadDialogs();
  const noLines = [{ id: 'a', label: 'A', primary: true }, { id: 'b', label: 'B', primary: false }];
  dialogs.choiceDialog('T', 'M', noLines);
  assert.equal(els.get('#confirm-details').classList.contains('hidden'), true);
  buttons[0].onclick();
});

test('choiceDialog: Cancel resolves null, without calling any choice\'s own handler', async () => {
  const { dialogs, els } = loadDialogs();
  const p = dialogs.choiceDialog('Title', 'Message', CHOICES);
  els.get('#btn-confirm-no').onclick();
  assert.equal(await p, null);
});

test('keptWorkDialog: "resume" opens Resume from step… for that run; resolves \'resume\'', async () => {
  const { dialogs, buttons, resumeCalls } = loadDialogs();
  const p = dialogs.keptWorkDialog({ title: 'T', message: 'M', choices: CHOICES, runId: '20260101-run1' });
  buttons[0].onclick(); // 'resume' is the first choice
  assert.equal(await p, 'resume');
  assert.deepEqual(resumeCalls, ['20260101-run1']);
});

test('keptWorkDialog: "scratch" never opens Resume from step…', async () => {
  const { dialogs, buttons, resumeCalls } = loadDialogs();
  const p = dialogs.keptWorkDialog({ title: 'T', message: 'M', choices: CHOICES, runId: '20260101-run1' });
  buttons[1].onclick(); // 'scratch' is the second choice
  assert.equal(await p, 'scratch');
  assert.deepEqual(resumeCalls, []);
});

test('keptWorkDialog: Cancel (null) never opens Resume from step…', async () => {
  const { dialogs, els, resumeCalls } = loadDialogs();
  const p = dialogs.keptWorkDialog({ title: 'T', message: 'M', choices: CHOICES, runId: '20260101-run1' });
  els.get('#btn-confirm-no').onclick();
  assert.equal(await p, null);
  assert.deepEqual(resumeCalls, []);
});
