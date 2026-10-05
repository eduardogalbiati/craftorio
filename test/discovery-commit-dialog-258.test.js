// #258 The commit dialog and the committed card's panel on the Discovery board
// (src/renderer/views/discovery/discovery-commit.js, discovery.js), with the board harness
// (test/discovery-board-harness.js): "Commit to the backlog" opens the dialog with the proposed
// issues, the owner's edits are what File the issues files, a refusal stays in the dialog, and a
// committed card opens read-only with its delivery and "New card from this one".
const test = require('node:test');
const assert = require('node:assert/strict');
const { boardApi, card, openBoard, settle, P } = require('./discovery-board-harness');

const tid = (id) => `[data-testid="${id}"]`;
const SPLIT = {
  issues: [
    { title: 'Export the runs table', tasks: ['Add the CSV writer', 'Add the Export button'], complexity: 2, workflow: 'software-development.yaml', reason: '' },
    { title: 'Document the export', tasks: ['Describe the CSV columns'], complexity: 1, workflow: 'software-development.yaml', reason: 'Ships on its own.' },
  ],
};

// The board with one Ready card at 90%, the proposal above and a commit that records its calls.
async function boardWithCommit({ commit } = {}) {
  const ready = card({ title: 'Export runs as CSV', column: 'ready', clarity: 90 });
  const calls = [];
  const { store, methods } = boardApi({ cards: [ready] });
  let committed = [];
  const page = await openBoard({
    cards: [ready],
    api: {
      discoveryBoard: async () => ({ ...(await methods.discoveryBoard()), committed }),
      listDiscoveryCards: async () => (committed.length ? [] : [structuredClone(ready)]),
      proposeDiscoveryCommit: async () => ({ split: structuredClone(SPLIT), model: 'simulated', costUsd: 0 }),
      commitDiscoveryCard: async (projectId, cardId, split) => {
        calls.push([projectId, cardId, split]);
        if (commit) return commit(split);
        const issues = split.issues.map((i, n) => ({ ...i, number: 101 + n, url: `https://github.com/o/r/issues/${101 + n}` }));
        const done = { ...ready, column: 'committed', links: { issues: issues.map((i) => i.number), release: null } };
        committed = [{ ...done, delivery: { stage: 'in_delivery', counts: { todo: issues.length, running: 0, local: 0, done: 0 }, issues: issues.map((i) => ({ number: i.number, column: 'todo', title: i.title, url: i.url, release: null })), release: null } }];
        return { issues, card: done, simulated: true };
      },
    },
  });
  return { page, ready, calls, store };
}

async function openDialog(page, id) {
  const detail = await page.openCard(id);
  detail.querySelector(tid('discovery-commit')).click();
  await settle(20);
  return page.$(tid('discovery-commit-dialog'));
}

const submit = async (page, dialog) => {
  const { Event } = page.dom.classes;
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(30);
};

test('the dialog lists the proposed issues, editable, and File the issues files the owner\'s edit', async () => {
  const { page, ready, calls } = await boardWithCommit();
  const dialog = await openDialog(page, ready.id);
  assert.ok(page.visible(dialog));
  assert.equal(dialog.getAttribute('role'), 'dialog');
  const rows = dialog.querySelectorAll(tid('discovery-commit-issue'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('[data-commit-title]').value, 'Export the runs table');
  assert.equal(rows[0].querySelector('[data-commit-tasks]').value, 'Add the CSV writer\nAdd the Export button');
  assert.equal(rows[1].querySelector('[data-commit-cx]').value, '1');
  const file = dialog.querySelector(tid('discovery-commit-file'));
  assert.equal(page.text(file), 'File the issues');
  assert.equal(!!file.disabled, false);

  rows[0].querySelector('[data-commit-title]').value = 'Export the runs table as CSV';
  rows[1].querySelector('[data-commit-tasks]').value = 'Describe the CSV columns\n\n  Link the export from the README  ';
  await submit(page, dialog);

  // (through JSON: the split was built in the page's own realm)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[P, ready.id, {
    issues: [
      { title: 'Export the runs table as CSV', tasks: ['Add the CSV writer', 'Add the Export button'], complexity: 2, workflow: 'software-development.yaml' },
      { title: 'Document the export', tasks: ['Describe the CSV columns', 'Link the export from the README'], complexity: 1, workflow: 'software-development.yaml' },
    ],
  }]]);
  assert.equal(page.visible(dialog), false);
  assert.equal(page.$(tid('discovery-card-detail')), null, 'the panel closes: the card left the board');
  const entry = page.$(tid('discovery-committed')).querySelector(tid('discovery-committed-card'));
  assert.equal(entry.getAttribute('data-card'), ready.id);
  assert.match(page.text(entry.querySelector(tid('discovery-delivery'))), /In delivery 2 to do #101 Export the runs table as CSV To do/);
  assert.equal(entry.querySelector(tid('card-move')), null);
  assert.equal(page.cardEl(ready.id), null);
});

test('"merge with issue 2" joins two issues; an issue without a title is refused before anything is filed', async () => {
  const { page, ready, calls } = await boardWithCommit();
  const dialog = await openDialog(page, ready.id);
  dialog.querySelector('[data-commit-merge="0"]').click();
  await settle();
  const rows = dialog.querySelectorAll(tid('discovery-commit-issue'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('[data-commit-tasks]').value, 'Add the CSV writer\nAdd the Export button\nDescribe the CSV columns');

  rows[0].querySelector('[data-commit-title]').value = '  ';
  await submit(page, dialog);
  assert.deepEqual(calls, []);
  assert.match(page.text(dialog.querySelector('#dsc-commit-error')), /Issue 1 needs a title/);
  assert.ok(page.visible(dialog));
});

test('a refused commit stays in the dialog with the reason; Cancel files nothing', async () => {
  const { page, ready, calls } = await boardWithCommit({ commit: () => { throw new Error('Its clarity is 80%: a card is committed from 85%.'); } });
  const dialog = await openDialog(page, ready.id);
  await submit(page, dialog);
  assert.equal(calls.length, 1);
  assert.ok(page.visible(dialog));
  assert.match(page.text(dialog.querySelector('#dsc-commit-error')), /committed from 85%/);
  assert.equal(!!dialog.querySelector(tid('discovery-commit-file')).disabled, false, 'the commit can be tried again');
  dialog.querySelector('#btn-dsc-commit-cancel').click();
  await settle();
  assert.equal(page.visible(dialog), false);
  assert.equal(page.cardColumn(ready.id), 'ready');
});

test('while the issues are being filed the dialog cannot be cancelled, by its button or by Esc', async () => {
  let release;
  const filed = new Promise((resolve) => { release = resolve; });
  const { page, ready, calls } = await boardWithCommit({ commit: async () => { await filed; throw new Error('gh: network down'); } });
  const dialog = await openDialog(page, ready.id);
  const { Event } = page.dom.classes;
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const cancel = dialog.querySelector('#btn-dsc-commit-cancel');
  assert.equal(!!cancel.disabled, true);
  assert.equal(!!dialog.querySelector(tid('discovery-commit-file')).disabled, true);
  page.document.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await settle();
  assert.ok(page.visible(dialog), 'Esc leaves the dialog open while filing');
  // a second submit meanwhile files nothing more
  dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  release();
  await settle(30);
  assert.equal(calls.length, 1);
  assert.equal(!!cancel.disabled, false);
  assert.match(page.text(dialog.querySelector('#dsc-commit-error')), /network down/);
  page.document.dispatchEvent(new Event('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await settle();
  assert.equal(page.visible(dialog), false, 'Esc is Cancel once nothing is being filed');
  assert.ok(page.$(tid('discovery-card-detail')), 'the card\'s panel stays open behind the dialog');
});

test('a committed card opens read-only, with its delivery and "New card from this one"', async () => {
  const done = { ...card({ title: 'Export runs as CSV', column: 'committed', clarity: 90 }), links: { issues: [101], release: null } };
  const delivery = { stage: 'released', counts: { todo: 0, running: 0, local: 0, done: 1 }, issues: [{ number: 101, column: 'done', title: 'Export the runs table', url: 'https://github.com/o/r/issues/101', release: 'v1.2' }], release: 'v1.2' };
  const created = [];
  const { methods } = boardApi({ cards: [] });
  const page = await openBoard({
    cards: [],
    api: {
      discoveryBoard: async () => ({ ...(await methods.discoveryBoard()), committed: [{ ...done, delivery }] }),
      getDiscoveryCard: async () => structuredClone(done),
      createDiscoveryCard: async (...args) => { created.push(args); return { ...card({ title: args[1], column: 'inbox' }), links: { issues: [], release: null, from: args[4] } }; },
    },
  });
  const entry = page.$(tid('discovery-committed')).querySelector(tid('discovery-committed-card'));
  assert.match(page.text(entry.querySelector(tid('discovery-delivery-stage'))), /^Released v1\.2$/);
  entry.querySelector('[data-open]').click();
  await settle(20);
  const detail = page.$(tid('discovery-card-detail'));
  assert.ok(detail, 'the committed card opens');
  assert.equal(!!detail.querySelector(tid('card-type')).disabled, true);
  assert.equal(!!detail.querySelector(tid('card-tags')).disabled, true);
  assert.equal(detail.querySelector(tid('discovery-commit')), null);
  assert.equal(detail.querySelector(tid('card-move')), null);
  assert.equal(page.visible(detail.querySelector('#dsc-note')), false);
  assert.equal(page.visible(detail.querySelector('[data-detail="attach"]')), false);
  assert.equal(page.visible(detail.querySelector('#dsc-acc-edit')), false);
  assert.match(page.text(detail.querySelector(tid('discovery-delivery'))), /^Released v1\.2 1 done #101 Export the runs table Released$/);
  // a click the read-only panel does not take changes nothing
  detail.querySelector('[data-detail="edit-acc"]').click();
  await settle();
  assert.equal(detail.querySelector('#dsc-acc'), null);

  detail.querySelector(tid('card-new-from')).click();
  await settle(20);
  assert.deepEqual(created, [[P, 'Learned from: Export runs as CSV', '', 'idea', done.id]]);
});
