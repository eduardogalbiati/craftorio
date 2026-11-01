// #671 the behaviour behind the Documents mockups (fronts/plan/views/docs/docs.js, docs-diff.js,
// docs-panels.js) in the renderer harness (packages/ui-kit/test/renderer-app-harness.js) with a fake
// window.api: the Diff tab of a change (read at the change, docs:read-at: reading, error, touched and
// unchanged sections, no section), a change card opening it, the review notes' Apply / Edit / Dismiss
// (sent as a request at the edit gate, queued at the approval gate, off without a run, the sign-off's
// pill redrawn) and the writer's queue (a request that fails stays queued with its error).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@multiagent/ui-kit/test/renderer-app-harness');

const ITEMS = [
  { item: 'write-doc', stage: 'design', docs: [
    { doc: 'intent', file: 'docs/work/write-doc/intent.md', status: 'accepted', translation: 'intent.pt-BR.md' },
    { doc: 'spec', file: 'docs/work/write-doc/spec.md', status: 'draft', translation: 'spec.pt-BR.md' },
  ] },
];

const SPEC_MD = [
  '# Write doc',
  '',
  '## Requirements',
  '',
  '**R1. Documents screen.** The list of the work items and their documents.',
  '',
  '**R2. The living document.** The document is edited by request, one commit each.',
  '',
  '## Design',
  '',
  'The editor draws the document in a sandboxed page.',
  '',
].join('\n');
const SPEC_DOC = { item: 'write-doc', doc: 'spec', status: 'draft', source: { file: 'docs/work/write-doc/spec.md', markdown: SPEC_MD }, translation: null };
const R1_AFTER = SPEC_MD.replace('their documents.', 'their documents, also offline.');

const CHANGES = {
  changes: [
    { commit: 'c1aaaaaaaa', messageId: 'req-1', subject: 'Shorten the summary', files: ['docs/work/write-doc/spec.md'], undone: false },
    { commit: 'c2bbbbbbbb', messageId: 'req-2', subject: 'Add the offline case to R1', files: ['docs/work/write-doc/spec.md'], undone: false },
  ],
  unreviewed: ['c2bbbbbbbb'],
  base: 'abc123',
};

const NOTE = { anchor: 'r1', severity: 'minor', quote: 'work items', text: 'Name the offline case.' };
const REVIEW = { type: 'step.finished', step_id: 'review', output: { score: 8.4, summary: 'ok', checks: [], notes: [NOTE] } };
const EDIT_GATE = { type: 'approval.requested', approval_id: 'a3', step_id: 'edit', edit: { agent: 'writer' } };
const APPROVAL_GATE = { type: 'approval.requested', approval_id: 'a7', step_id: 'approval', choices: ['accept', 'revise'] };
const WRITER_TURN = { output: { source_text: '**R1. Documents screen.** The list of the work items, also offline.', reply: 'Done.' } };

async function editorApp(api = {}) {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => ITEMS,
      readDoc: async () => SPEC_DOC,
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      applyDocRequest: async () => ({}),
      resolveApproval: async () => ({}),
      ...api,
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}
async function openSpec(app, events = []) {
  await app.run("DocsActions.openDoc('write-doc', 'spec')");
  await app.settle(10);
  if (events.length) {
    await app.run(`DocsActions.follow('r1', ${JSON.stringify(events)})`);
    await app.settle(10);
  }
}

// a click on a control of the editor carrying the data-* attribute `name` (its value `value`), seen by
// the editor's click listener; a fresh element each time, so no attribute of an earlier click stays
let clicks = 0;
async function clickIn(app, name, value = '') {
  clicks += 1;
  const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  await app.click(`#t-click-${clicks}`, { dataset: { [key]: value }, attrs: { [name]: value }, within: ['#docs-editor'] });
  await app.settle(10);
}

// `message` sent from the writer's text box. The harness gives every AgentChat of the page the same fake
// form and text box (keyed by selector), so each chat's submit listener is tried, newest first, the box
// filled again each time, until `sent()` says the Documents chat took it
async function sendFromChat(app, message, sent) {
  const input = app.el('[data-testid="agent-chat-input"]');
  for (const fn of [...(app.el('[data-agent-chat-form]').listeners.submit || [])].reverse()) {
    input.value = message;
    fn({ type: 'submit', preventDefault() {} });
    await app.settle(10);
    if (sent()) return;
  }
}

const elementsOf = (app) => [...app.elements.values(), ...app.created];
const allMarkup = (app) => elementsOf(app).map((e) => e.innerHTML || '').join('\n');
const boxHtml = (app, sel) => app.el(sel).innerHTML || '';
const boxText = (app, sel) => `${app.el(sel).textContent || ''} ${text(boxHtml(app, sel))}`;

function elementsWith(html, mark) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf(mark, from);
    if (at < 0) return out;
    const start = html.lastIndexOf('<', at);
    const tag = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))?.[1];
    const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    let end = html.length;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      if (m[1]) depth -= 1;
      else if (!m[0].endsWith('/>')) depth += 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    }
    out.push(html.slice(start, end));
    from = at + mark.length;
  }
}
const fragments = (html, id) => elementsWith(html, `data-testid="${id}"`);
const fragment = (html, id) => fragments(html, id)[0] || '';
const openTag = (html) => html.slice(0, html.indexOf('>') + 1);

// the spec opened at its edit gate with the two changes, the Diff tab of change `commit` open
async function diffOf(readDocAt, commit = 'c2bbbbbbbb') {
  const app = await editorApp({ listDocChanges: async () => CHANGES, readDocAt });
  await openSpec(app, [EDIT_GATE]);
  await clickIn(app, 'data-docs-change', commit);
  return app;
}

// ---- the Diff tab (mock-3) -------------------------------------------------------------------------
test('#671 the Diff tab says it is reading the change while docs:read-at has not answered', async () => {
  const app = await diffOf(() => new Promise(() => {}));
  const page = boxHtml(app, '#docs-diff');
  assert.equal(page.includes('role="status"'), true, 'no status line');
  assert.equal(text(page).includes('Reading the change…'), true, text(page));
  assert.deepEqual(app.callsTo('readDocAt').map((a) => Array.from(a).join('|')), ['p1|write-doc|spec|c2bbbbbbbb|r1']);
});

test('#671 the Diff tab shows the error when the change cannot be read', async () => {
  const app = await diffOf(async () => { throw new Error('not a commit of this item'); });
  const page = boxHtml(app, '#docs-diff');
  assert.equal(text(page).includes('not a commit of this item'), true, text(page));
  assert.equal(fragments(page, 'doc-diff-section').length, 0);
});

test('#671 the Diff tab draws the touched section with its inserted words and its neighbour as unchanged', async () => {
  const app = await diffOf(async () => ({ file: 'spec.md', before: SPEC_MD, after: R1_AFTER }));
  const secs = fragments(boxHtml(app, '#docs-diff'), 'doc-diff-section');
  const r1 = secs.find((s) => text(s).includes('R1 · Documents screen')) || '';
  const r2 = secs.find((s) => text(s).includes('R2 · The living document')) || '';
  assert.equal(r1.includes('#spec-r1'), true, r1);
  assert.match(r1, /<ins>[^<]*offline[^<]*<\/ins>/);
  assert.equal(text(r1).includes('Unchanged in this request'), false);
  assert.equal(text(r2).includes('Unchanged in this request'), true, r2);
  assert.equal(r2.includes('<ins>') || r2.includes('<del>'), false);
});

test('#671 the Diff tab shows the removed words of a change', async () => {
  const before = R1_AFTER;
  const app = await diffOf(async () => ({ file: 'spec.md', before, after: SPEC_MD }));
  const r1 = fragments(boxHtml(app, '#docs-diff'), 'doc-diff-section').find((s) => text(s).includes('R1 · Documents screen')) || '';
  assert.match(r1, /<del>[^<]*offline[^<]*<\/del>/);
});

test('#671 the Diff tab says so when the request changed no section', async () => {
  const app = await diffOf(async () => ({ file: 'spec.md', before: SPEC_MD, after: SPEC_MD }));
  const page = boxHtml(app, '#docs-diff');
  assert.equal(text(page).includes('This request changed no section.'), true, text(page));
  assert.equal(fragments(page, 'doc-diff-section').length, 0);
});

test('#671 a click on a change card opens the Diff tab on that change, read once', async () => {
  const app = await diffOf(async () => ({ file: 'spec.md', before: SPEC_MD, after: SPEC_MD }), 'c1aaaaaaaa');
  const detail = fragment(boxHtml(app, '#docs-diff'), 'doc-change-detail');
  assert.equal(text(detail).includes('Shorten the summary'), true, text(detail));
  assert.match(text(detail), /v1\s*→\s*v2/);
  const diffTab = elementsWith(allMarkup(app), 'data-docs-tab="diff"').find((f) => f.includes('role="tab"')) || '';
  assert.equal(openTag(diffTab).includes('aria-selected="true"'), true, openTag(diffTab));
  await clickIn(app, 'data-docs-change', 'c1aaaaaaaa');
  assert.equal(app.callsTo('readDocAt').length, 1);
});

// ---- the review notes (mock-4) -----------------------------------------------------------------------
test('#671 Apply sends a review note to the writer at the edit gate and the note leaves the list', async () => {
  const app = await editorApp({ requestEdit: async () => WRITER_TURN });
  await openSpec(app, [REVIEW, EDIT_GATE]);
  await clickIn(app, 'data-docs-note-apply', '0');
  const calls = app.callsTo('requestEdit');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'a3');
  assert.equal(String(calls[0][2]).startsWith('Request: Apply the review note on #r1: Name the offline case.'), true, String(calls[0][2]).slice(0, 80));
  assert.equal(app.callsTo('applyDocRequest').length, 1);
  assert.equal(fragments(allMarkup(app), 'doc-review-note').length, 0);
});

test('#671 a review note the writer fails to apply stays in the list with the error', async () => {
  const app = await editorApp({ requestEdit: async () => { throw new Error('The writer stopped'); } });
  await openSpec(app, [REVIEW, EDIT_GATE]);
  await clickIn(app, 'data-docs-note-apply', '0');
  assert.equal(fragments(allMarkup(app), 'doc-review-note').length, 1);
  assert.equal(boxText(app, '#docs-editor-error').includes('The writer stopped'), true, boxText(app, '#docs-editor-error'));
  assert.equal(app.callsTo('applyDocRequest').length, 0);
});

test('#671 Apply at the approval gate queues the note, goes back to editing and sends it when the writer waits', async () => {
  const app = await editorApp({ requestEdit: async () => WRITER_TURN });
  await openSpec(app, [REVIEW, APPROVAL_GATE]);
  await clickIn(app, 'data-docs-note-apply', '0');
  const note = fragment(allMarkup(app), 'doc-review-note');
  assert.equal(text(fragment(note, 'doc-note-queued')), 'queued');
  assert.equal(openTag(fragment(note, 'doc-note-apply')).includes('disabled'), true, 'a queued note can be applied again');
  assert.deepEqual(app.callsTo('resolveApproval').map((a) => [a[0], a[1]]), [['a7', 'revise']]);
  assert.equal(app.callsTo('requestEdit').length, 0);
  await app.run(`DocsActions.follow('r1', ${JSON.stringify([EDIT_GATE])})`);
  await app.settle(10);
  assert.equal(app.callsTo('requestEdit').length, 1);
  assert.equal(app.callsTo('requestEdit')[0][1], 'a3');
  assert.equal(fragments(allMarkup(app), 'doc-review-note').length, 0);
});

test('#671 Apply is off when no run is followed', async () => {
  const app = await editorApp();
  await openSpec(app, [REVIEW, { type: 'run.finished' }]);
  const note = fragment(allMarkup(app), 'doc-review-note');
  assert.equal(note === '', false, 'the note left with the run');
  assert.equal(openTag(fragment(note, 'doc-note-apply')).includes('disabled'), true, openTag(fragment(note, 'doc-note-apply')));
});

test('#671 Dismiss takes the note out of the list and out of the sign-off pill', async () => {
  const app = await editorApp();
  await openSpec(app, [REVIEW, APPROVAL_GATE]);
  assert.match(text(fragment(allMarkup(app), 'doc-signoff-review')), /\b1 open note\b/);
  await clickIn(app, 'data-docs-note-dismiss', '0');
  assert.equal(fragments(allMarkup(app), 'doc-review-note').length, 0);
  assert.doesNotMatch(text(fragment(allMarkup(app), 'doc-signoff-review')), /\b1 open note\b/);
  assert.equal(app.callsTo('resolveApproval').length, 0);
});

test('#671 Edit puts the note in the text box and takes it out of the list', async () => {
  const app = await editorApp();
  await openSpec(app, [REVIEW, EDIT_GATE]);
  await clickIn(app, 'data-docs-note-edit', '0');
  assert.equal(app.el('[data-testid="agent-chat-input"]').value, 'Name the offline case.');
  assert.equal(fragments(allMarkup(app), 'doc-review-note').length, 0);
  assert.equal(text(fragment(allMarkup(app), 'doc-selection-chip')).includes('Documents screen'), true);
});

// ---- the writer's queue (mock-2) -------------------------------------------------------------------
test('#671 a queued request that fails stays queued with its error; applied again, it leaves the queue', async () => {
  let fail = true;
  const app = await editorApp({ requestEdit: async () => { if (fail) throw new Error('The writer is busy'); return WRITER_TURN; } });
  await openSpec(app, [REVIEW, EDIT_GATE]);
  await clickIn(app, 'data-docs-mode', 'queue');
  await clickIn(app, 'data-docs-note-edit', '0'); // the R1 selection and the note's text in the box
  await sendFromChat(app, 'Name the offline case.', () => text(boxHtml(app, '#docs-queue')).includes('Name the offline case.'));
  assert.equal(app.callsTo('requestEdit').length, 0, 'Queue sent the request');
  assert.equal(text(boxHtml(app, '#docs-queue')).includes('Name the offline case.'), true, text(boxHtml(app, '#docs-queue')));

  await clickIn(app, 'data-docs-queue-apply');
  assert.equal(app.callsTo('requestEdit').length, 1);
  const queue = boxHtml(app, '#docs-queue');
  assert.equal(queue.includes('docs-queue-error'), true, 'no error on the queued request');
  assert.equal(text(queue).includes('The writer is busy'), true, text(queue));
  assert.equal(text(queue).includes('Name the offline case.'), true, 'the failed request left the queue');

  fail = false;
  await clickIn(app, 'data-docs-queue-apply');
  assert.equal(app.callsTo('requestEdit').length, 2);
  assert.equal(app.callsTo('applyDocRequest').length, 1);
  assert.equal(text(boxHtml(app, '#docs-queue')).includes('Name the offline case.'), false);
});
