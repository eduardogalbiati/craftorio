// Screenshot seed of the Findings button (#361, --view findings): the setting on (a capture hides the
// button otherwise) and three saved findings (saved, sent to the Product Owner, filed with its issue).
// --mode marking (default): the overlay over the frozen Dashboard, three numbered pins and a note;
// --mode saved: the same, saved ("Open folder"); --mode list: Settings › General › Findings.

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const NOTE = "The run card's status pill overlaps its title when the title is long";

function seed({ ws, project, src, workspace }) {
  workspace.writeSettings(ws, { findingsButton: true });
  let findings;
  try {
    findings = src('findings');
  } catch {
    return; // an app before #361
  }
  const day = 864e5;
  const demo = [
    ['The Backlog\'s empty state has no call to action to sync the issues', 3, { status: 'filed', projectId: project.id, issueUrl: 'https://github.com/demo/demo-app/issues/412' }],
    ['Analytics: the cost of yesterday\'s runs shows US$ 0.00 although two real runs finished', 1, { status: 'sent', projectId: project.id }],
    [NOTE, 0.1, null],
  ];
  for (const [note, daysAgo, filing] of demo) {
    const saved = findings.saveFinding(ws, { image: TINY_PNG, marked: TINY_PNG, marks: [], note, context: { view: 'dashboard' }, at: new Date(Date.now() - daysAgo * day) });
    if (filing) findings.markFiling(ws, saved.id, filing);
  }
}

function open({ args, click }) {
  return click(`.nav-item[data-view="${args.mode === 'list' ? 'settings' : 'dashboard'}"]`);
}

async function afterOpen({ args, click, js, pause }) {
  if (args.mode === 'list') { await click('.settings-tab[data-stab="general"]'); return; }
  await js('await window.Findings.refresh();');
  await click('[data-testid="findings-button"]');
  await pause(800);
  await js(`
    const c = document.querySelector('[data-testid="findings-canvas"]');
    const r = c.getBoundingClientRect();
    for (const [x, y] of [[0.3, 0.22], [0.62, 0.4], [0.45, 0.7]]) c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y }));
    const note = document.querySelector('[data-testid="findings-note"]');
    note.value = ${JSON.stringify(NOTE)};
    const first = document.querySelector('[data-fd-note="0"]');
    if (first) { first.value = 'The pill sits on the title'; first.dispatchEvent(new Event('input', { bubbles: true })); }`);
  if (args.mode === 'saved') {
    await click('[data-testid="findings-save"]');
    await pause(1000);
  }
}

module.exports = {
  afterOpen,
  modes: ['marking', 'saved', 'list'],
  open,
  seed,
};
