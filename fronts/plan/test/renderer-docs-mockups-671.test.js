// #671 the Documents screens (fronts/plan/views/docs/docs.js, #647) match the spec's mockups
// (docs/work/write-doc/images/mock-1..5.jpg and living-doc.jpg). The real page in the renderer harness
// (packages/ui-kit/test/renderer-app-harness.js) with a fake window.api; the contract is the testids and
// the English texts of the mockups: the list rows (SDLC stage chain, status pill), the New item side
// panel, the editor (stepper, title bar, contents, toolbar, reader anchors, writer panel), the changes
// by request, the review with anchored notes and the sign-off gate. The #647 behaviour is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const ITEMS = [
  { item: 'write-doc', stage: 'design', docs: [
    { doc: 'intent', file: 'docs/work/write-doc/intent.md', status: 'accepted', translation: 'intent.pt-BR.md' },
    { doc: 'spec', file: 'docs/work/write-doc/spec.md', status: 'draft', translation: 'spec.pt-BR.md' },
  ] },
  { item: 'offline-mode', stage: 'intent', docs: [
    { doc: 'intent', file: 'docs/work/offline-mode/intent.md', status: 'draft', translation: 'intent.pt-BR.md' },
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

const CHANGES = {
  changes: [
    { commit: 'c1aaaaaaaa', messageId: 'req-1', subject: 'Shorten the summary', files: ['docs/work/write-doc/spec.md'], undone: false },
    { commit: 'c2bbbbbbbb', messageId: 'req-2', subject: 'Add the offline case to R1', files: ['docs/work/write-doc/spec.md'], undone: false },
  ],
  unreviewed: ['c2bbbbbbbb'],
  base: 'abc123',
};

const REVIEW = {
  type: 'step.finished', step_id: 'review', output: {
    score: 8.4, summary: 'ok',
    checks: [
      { name: 'Every decision has options and a recommendation', result: 'pass' },
      { name: 'Costs say what is estimated', result: 'note' },
    ],
    notes: [{ anchor: 'costs', severity: 'minor', quote: 'about $1–2', text: 'Say which figures come from the estimate.' }],
  },
};
const EDIT_GATE = { type: 'approval.requested', approval_id: 'a3', step_id: 'edit', edit: { agent: 'writer' } };
const APPROVAL_GATE = { type: 'approval.requested', approval_id: 'a7', step_id: 'approval', choices: ['accept', 'revise'] };

// The Documents screen of a project with a folder; `api` overrides the defaults.
async function editorApp(api = {}) {
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => ITEMS,
      readDoc: async () => SPEC_DOC,
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => ({ runId: 'r9' }),
      ...api,
    },
  });
  await app.boot();
  app.run("showView('docs')");
  await app.settle(10);
  return app;
}
// the spec of write-doc open, followed from run r1 with `events`
async function openSpec(app, events = []) {
  await app.run("DocsActions.openDoc('write-doc', 'spec')");
  await app.settle(10);
  if (events.length) {
    await app.run(`DocsActions.follow('r1', ${JSON.stringify(events)})`);
    await app.settle(10);
  }
}

const elementsOf = (app) => [...app.elements.values(), ...app.created];
// all the markup the page's elements hold, the view's own markup and modals included
const allMarkup = (app) => elementsOf(app).map((e) => e.innerHTML || '')
  .concat(app.defs.get('docs')?.markup || '', app.defs.get('docs')?.modals || '').join('\n');
// the markup and the attributes the elements carry (a placeholder set on a created textarea)
const everything = (app) => [allMarkup(app), ...elementsOf(app).flatMap((e) => [e.placeholder || '', ...Object.values(e.attrs || {})])].join('\n');
// the reader page(s): every iframe's srcdoc
const srcdocs = (app) => elementsOf(app).map((e) => (typeof e.srcdoc === 'string' ? e.srcdoc : '')).join('\n');

// The markup of each element carrying data-testid="<id>" (its opening tag through its closing tag).
const fragments = (html, id) => elementsWith(html, `data-testid="${id}"`);
// the markup of each element whose opening tag carries the attribute `mark` (e.g. role="tab")
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
const fragment = (html, id) => fragments(html, id)[0] || '';
const has = (html, id) => html.includes(`data-testid="${id}"`);
const row = (app, item) => fragments(allMarkup(app), 'docs-item').find((f) => f.includes(`data-item="${item}"`)) || '';

// ---- mock-1: Documents and New item ----------------------------------------------------------------
test('#671 the Documents page says what documents are and where approved ones are committed', async () => {
  const app = await editorApp();
  assert.equal(text(allMarkup(app)).includes('Proposals, RFCs and PRDs you write with the agents and review here. Approved documents are committed to the project under docs/work/.'), true);
});

test('#671 the list row shows its SDLC stages with the done ones checked', async () => {
  const app = await editorApp();
  const writeDoc = fragment(row(app, 'write-doc'), 'docs-item-stages');
  const offline = fragment(row(app, 'offline-mode'), 'docs-item-stages');
  assert.equal(writeDoc !== '', true, 'the write-doc row has no docs-item-stages');
  assert.match(text(writeDoc), /^Plan\s*✓\s*·\s*Design$/);
  assert.match(text(offline), /^Plan$/);
});

test('#671 the list row shows the pill of its latest document with its state', async () => {
  const app = await editorApp();
  assert.match(text(fragment(row(app, 'write-doc'), 'docs-item-pill')), /spec\.md\s*·\s*draft/);
  assert.match(text(fragment(row(app, 'offline-mode'), 'docs-item-pill')), /intent\.md\s*·\s*draft/);
});

test('#671 the list row of a document a writer run is editing shows the editing pill', async () => {
  const app = await editorApp({ listDocItems: async () => [{ ...ITEMS[0], runId: 'r1', runDoc: 'spec' }] });
  assert.match(text(fragment(row(app, 'write-doc'), 'docs-item-pill')), /editing/);
});

test('#671 New item is a side panel with starts with, what it is about, screens, several writers, estimate and Start', async () => {
  const app = await editorApp();
  const html = allMarkup(app);
  const t = text(html);
  assert.equal(has(html, 'docs-new-panel'), true, 'no docs-new-panel');
  assert.equal(text(fragment(html, 'docs-new-panel')).includes('New item'), true, 'the panel has no New item heading');
  for (const id of ['docs-new-starts-with', 'docs-new-item-title', 'docs-new-screens', 'docs-new-screen-add', 'docs-new-writers', 'docs-new-estimate', 'docs-new-item-start']) {
    assert.equal(has(html, id), true, `no ${id}`);
  }
  const firstOption = /<option[^>]*>([\s\S]*?)<\/option>/.exec(fragment(html, 'docs-new-starts-with'))?.[1] || '';
  assert.equal(text(firstOption), 'intent.md (Plan)');
  for (const s of ['Starts with', 'What it is about', 'Screens to capture first', 'Several writers', 'Up to five models draft it; the best is merged (AI Arena).']) {
    assert.equal(t.includes(s), true, `no "${s}"`);
  }
  assert.equal(text(fragment(html, 'docs-new-screen-add')), '+ add');
  assert.match(text(fragment(html, 'docs-new-estimate')), /est\. \$/);
  assert.equal(text(fragment(html, 'docs-new-item-start')), 'Start');
});

// ---- living-doc.jpg + mock-2: the editor ----------------------------------------------------------
test('#671 the editor stepper shows the six SDLC steps in order with the open document current and its Draft badge', async () => {
  const app = await editorApp();
  await openSpec(app);
  const html = allMarkup(app);
  assert.equal(has(html, 'doc-stepper'), true, 'no doc-stepper');
  const steps = fragments(fragment(html, 'doc-stepper'), 'doc-step');
  const expected = [['Plan', 'intent.md'], ['Design', 'spec.md'], ['Build', 'plan.md'], ['Test', 'test.md'], ['Deploy', 'deploy.md'], ['Maintain', 'maintain.md']];
  assert.equal(steps.length, 6, 'not six steps');
  expected.forEach(([name, file], i) => {
    const st = text(steps[i]);
    assert.equal(st.includes(String(i + 1)) && st.includes(name) && st.includes(file), true, `step ${i + 1} is not ${name} ${file}: ${st}`);
  });
  assert.deepEqual(steps.map((s) => /^<[^>]*aria-current="step"/.test(s)), [false, true, false, false, false, false]);
  assert.equal(text(steps[1]).includes('Draft'), true, 'the Design step has no Draft badge');
});

test('#671 the editor title bar names the item and the document version, and the folder line shows docs/work/<item>/', async () => {
  const app = await editorApp();
  await openSpec(app);
  const html = allMarkup(app);
  assert.match(text(fragment(html, 'doc-titlebar')), /Documents\s*·\s*write-doc/);
  assert.match(text(fragment(html, 'doc-version')), /spec\.md\s*·\s*v\d+/);
  assert.equal(text(html).includes('docs/work/write-doc/'), true, 'no folder line');
});

test('#671 the contents list the headings, each requirement as a sub-entry and the markdown source, with their legend', async () => {
  const app = await editorApp();
  await openSpec(app);
  const html = allMarkup(app);
  const toc = text(fragment(html, 'doc-toc'));
  for (const s of ['Design · spec.md', 'Requirements', 'R1 · Documents screen', 'R2 · The living document', 'Markdown source']) {
    assert.equal(toc.includes(s), true, `the contents have no "${s}": ${toc}`);
  }
  assert.match(toc, /R2 · The living document[\s\S]*Design[\s\S]*Markdown source$/);
  const legend = text(fragment(html, 'doc-toc-legend'));
  assert.match(legend, /changed in v\d+/);
  assert.equal(legend.includes('has a review note'), true);
});

test('#671 the toolbar has the Edit, Diff and Preview tabs, EN and PT, Versions and Send to review at the edit gate', async () => {
  const app = await editorApp();
  await openSpec(app, [EDIT_GATE]);
  const html = allMarkup(app);
  const bar = fragment(html, 'doc-toolbar');
  assert.equal(bar !== '', true, 'no doc-toolbar');
  const tabs = elementsWith(bar, 'role="tab"').map(text);
  assert.deepEqual(tabs, ['Edit', 'Diff', 'Preview']);
  assert.equal(text(fragment(html, 'doc-lang-en')), 'EN');
  assert.equal(text(fragment(html, 'doc-lang-pt')), 'PT');
  assert.equal(text(fragment(html, 'doc-versions')).includes('Versions'), true, 'no Versions button');
  assert.equal(text(fragment(html, 'doc-send-to-review')), 'Send to review');
});

test('#671 the reader page anchors each requirement and shows its stage and file kicker', async () => {
  const app = await editorApp();
  await openSpec(app);
  const page = srcdocs(app);
  assert.equal(page.includes('id="spec-r1"'), true, 'R1 has no id="spec-r1"');
  assert.equal(text(page).includes('#spec-r1'), true, 'no visible #spec-r1 label');
  assert.match(text(page), /DESIGN · SPEC\.MD/i);
});

test('#671 the writer panel shows the writer, the selection, the placeholder, Apply now or Queue and Attach image', async () => {
  const app = await editorApp();
  await openSpec(app, [EDIT_GATE]);
  const html = allMarkup(app);
  const all = everything(app);
  assert.equal(has(html, 'doc-writer-panel'), true, 'no doc-writer-panel');
  assert.equal(text(fragment(html, 'doc-writer-panel')).includes('Writer'), true, 'the panel has no Writer heading');
  assert.equal(text(html).includes('Selected:'), true, 'no "Selected:"');
  assert.equal(all.includes('Say what to change in the selection, or paste a screenshot…'), true, 'no placeholder');
  assert.equal(text(fragment(html, 'doc-apply-now')), 'Apply now');
  assert.equal(text(fragment(html, 'doc-queue')), 'Queue');
  assert.equal(text(fragment(html, 'doc-attach-image')).includes('Attach image'), true, 'no Attach image');
});

// ---- mock-3: changes by request -------------------------------------------------------------------
async function withChanges() {
  const app = await editorApp({
    listDocItems: async () => [{ ...ITEMS[0], runId: 'r1', runDoc: 'spec' }, ITEMS[1]],
    listActiveRuns: async () => [{ runId: 'r1', gates: [{ approval_id: 'a3', step_id: 'edit', edit: { agent: 'writer' } }] }],
    listDocChanges: async () => CHANGES,
  });
  await app.click('#docs-list', { dataset: { item: 'write-doc', docsOpen: 'spec', run: 'r1' } });
  await app.settle(10);
  return app;
}

test('#671 each change by request is a card with its version, its quoted request and its review state', async () => {
  const app = await withChanges();
  const html = allMarkup(app);
  assert.equal(text(html).includes('Changes by request'), true);
  const cards = fragments(html, 'doc-change');
  const first = cards.find((c) => c.includes('Shorten the summary')) || '';
  const second = cards.find((c) => c.includes('Add the offline case to R1')) || '';
  const version = (c) => Number((/\bv(\d+)\b/.exec(text(c)) || [])[1]);
  assert.equal(Number.isFinite(version(first)) && Number.isFinite(version(second)), true, 'a card has no v<n> label');
  assert.equal(version(second) > version(first), true, 'the later change has no higher version');
  assert.match(text(second), /[“"]Add the offline case to R1[”"]/);
  assert.equal(text(fragment(first, 'doc-change-state')), 'reviewed');
  assert.equal(text(fragment(second, 'doc-change-state')), 'unreviewed');
  assert.match(text(fragment(html, 'doc-unreviewed-count')), /1 unreviewed/);
});

test('#671 the detail of the first unreviewed change shows its versions, file, Undo this change, Mark reviewed and the footnote', async () => {
  const app = await withChanges();
  const html = allMarkup(app);
  const detail = fragment(html, 'doc-change-detail');
  const t = text(detail);
  assert.match(t, /v\d+\s*→\s*v\d+/);
  assert.equal(t.includes('spec.md'), true, 'the detail names no file');
  assert.equal(t.includes('Add the offline case to R1'), true, 'the detail is not the first unreviewed change');
  assert.equal(text(fragment(detail, 'doc-undo-change')), 'Undo this change');
  assert.equal(text(fragment(detail, 'doc-mark-reviewed')), 'Mark reviewed');
  assert.equal(t.includes('Only the sections this request touched are highlighted; everything else is greyed out.'), true, 'no footnote');
});

// ---- mock-4: review with anchored notes ----------------------------------------------------------
test('#671 the review shows its score, its rubric checks and each note anchored with its quote and actions', async () => {
  const app = await editorApp();
  await openSpec(app, [REVIEW]);
  const html = allMarkup(app);
  assert.equal(text(fragment(html, 'doc-review-score')), '8.4 / 10');
  const checks = fragments(html, 'doc-review-check').map(text);
  assert.equal(checks.length, 2, 'not two rubric checks');
  assert.equal(checks[0].includes('Every decision has options and a recommendation') && /\bpass\b/.test(checks[0]), true, checks[0]);
  assert.equal(checks[1].includes('Costs say what is estimated') && /\bnote\b/.test(checks[1]), true, checks[1]);
  const note = fragment(html, 'doc-review-note');
  const nt = text(note);
  for (const s of ['#costs', 'Reviewer', 'about $1–2', 'Say which figures come from the estimate.']) {
    assert.equal(nt.includes(s), true, `the note has no "${s}": ${nt}`);
  }
  assert.equal(text(fragment(note, 'doc-note-apply')), 'Apply');
  assert.equal(text(fragment(note, 'doc-note-edit')), 'Edit');
  assert.equal(text(fragment(note, 'doc-note-dismiss')), 'Dismiss');
});

// ---- mock-5: the sign-off gate --------------------------------------------------------------------
test('#671 the sign-off gate shows the review and unreviewed pills, the front matter after sign-off, the next steps and its buttons', async () => {
  const app = await editorApp({ listDocChanges: async () => ({ ...CHANGES, unreviewed: ['c1aaaaaaaa', 'c2bbbbbbbb'] }) });
  await openSpec(app, [REVIEW, APPROVAL_GATE]);
  const html = allMarkup(app);
  const panel = fragment(html, 'doc-signoff');
  assert.match(text(panel), /Sign off required\s*·\s*spec\.md/);
  assert.match(text(fragment(panel, 'doc-signoff-review')), /review\s*8\.4\s*\/\s*10\s*·\s*1\s+open notes?/);
  assert.match(text(fragment(panel, 'doc-signoff-unreviewed')), /2 unreviewed changes/);
  assert.match(text(fragment(panel, 'doc-signoff-frontmatter')), /status: draft\s*→\s*signed off/);
  const next = fragments(panel, 'doc-signoff-next').map(text).join(' | ');
  for (const s of ['Create epic and phase issues', 'The Product Owner proposes an epic and one sub-issue per phase of the spec; you review before anything is filed.',
    'Start the Build', 'The feature workflow drafts plan.md; it stays a draft until the engineer accepts it, before any code.']) {
    assert.equal(next.includes(s), true, `the next steps have no "${s}"`);
  }
  assert.equal(text(fragment(panel, 'doc-gate-accept')), 'Sign off spec');
  const revise = fragment(panel, 'doc-gate-revise');
  assert.equal(revise.includes('data-docs-gate="revise"'), true, 'Back to editing does not answer revise');
  assert.equal(text(revise), 'Back to editing');
  assert.equal(text(fragment(panel, 'doc-gate-cancel')), 'Stop');
});

test('#671 Sign off spec still accepts the document before it answers accept', async () => {
  const app = await editorApp();
  await openSpec(app, [REVIEW, APPROVAL_GATE]);
  await app.click('#docs-editor', { dataset: { docsGate: 'accept' } });
  await app.settle(10);
  assert.deepEqual(app.callsTo('acceptDoc').map((a) => [a[1], a[2]]), [['write-doc', 'spec']]);
  assert.deepEqual(app.callsTo('resolveApproval').map((a) => [a[0], a[1]]), [['a7', 'accept']]);
  const order = app.apiCalls.map(([n]) => n).filter((n) => n === 'acceptDoc' || n === 'resolveApproval');
  assert.deepEqual(order, ['acceptDoc', 'resolveApproval']);
});
