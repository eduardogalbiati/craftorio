// #256 The Inbox screen (Plan & Design › Inbox): quick capture (title + text) creates an `idea` card
// in the Inbox column of the header's project; the list shows the cards newest first with author,
// age and attachment count; Accept moves a card to Discovery › Triage.
// The screen is the real page (test/renderer-app-harness.js loads index.html's scripts in a vm
// sandbox with a fake window.api). The contract assumed here:
// - the view registers as id 'inbox' with nav { label: 'Inbox', group: 'plan' }, first in its group;
// - show() calls window.api.listDiscoveryCards(projectId, 'inbox') (or { projectId, column });
// - the capture form: #inbox-title, #inbox-text and the #inbox-capture button, which calls
//   createDiscoveryCard(projectId, title, text) (or { projectId, title, text });
// - each row's actions are delegated on #inbox-list: a click with data-action="accept" and
//   data-card="<card id>" calls moveDiscoveryCard(projectId, cardId, 'triage').
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp, navEntries, text } = require('./renderer-app-harness');

const NAV_GROUPS = path.join(__dirname, '..', 'src', 'renderer', 'nav-groups.js');
const navGroups = () => require(NAV_GROUPS);

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
const CARDS = [
  { id: '20261004-aaaa', title: 'Older idea', type: 'idea', column: 'inbox', author: 'alice', created: iso(300), updated: iso(300), attachments: [] },
  { id: '20261004-bbbb', title: 'Newer idea', type: 'idea', column: 'inbox', author: 'bob', created: iso(5), updated: iso(5), attachments: ['a.png', 'b.pdf'] },
];

// the first argument as { projectId, ... } whether the view passes positional args or one object
const argsOf = (args, names) => (args[0] && typeof args[0] === 'object' ? args[0] : Object.fromEntries(names.map((n, i) => [n, args[i]])));

async function inbox(api = {}) {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDiscoveryCards: async () => CARDS,
      createDiscoveryCard: async (...a) => ({ ...CARDS[0], id: '20261004-cccc', title: argsOf(a, ['projectId', 'title']).title }),
      moveDiscoveryCard: async () => ({ ...CARDS[0], column: 'triage' }),
      ...api,
    },
  });
  await app.boot();
  app.run("showView('inbox')");
  await app.settle(10);
  return app;
}
// all the markup the page's elements hold
const allMarkup = (app) => [...app.elements.values(), ...app.created].map((e) => e.innerHTML || '').join('\n');

test('the menu has Inbox as the first entry of Plan & Design', () => {
  const app = loadApp();
  const entries = navEntries(app.defs);
  const entry = entries.find((e) => text(e.label) === 'Inbox');
  assert.ok(entry, 'no Inbox menu entry');
  assert.equal(entry.id, 'inbox');
  assert.equal(entry.group, 'plan');
  const plan = navGroups().navLayout(entries).find((b) => b.group === 'plan');
  assert.equal(text(plan.items[0].label), 'Inbox');
});

test('opening the Inbox lists the header project\'s Inbox cards newest first with author, age and attachment count', async () => {
  const app = await inbox();
  assert.deepEqual(app.errors.filter((e) => !/no network/.test(String(e?.message))), []);
  const call = app.callsTo('listDiscoveryCards')[0];
  assert.ok(call, 'listDiscoveryCards was not called');
  const a = argsOf(call, ['projectId', 'column']);
  assert.equal(a.projectId, 'p1');
  assert.equal(a.column, 'inbox');
  const html = allMarkup(app);
  const newer = html.indexOf('Newer idea');
  const older = html.indexOf('Older idea');
  assert.ok(newer >= 0 && older >= 0, 'the cards are not rendered');
  assert.ok(newer < older, 'newest first');
  const t = text(html);
  assert.match(t, /bob/);
  assert.match(t, /alice/);
  assert.match(t, /\b2\b/, 'the attachment count of the newer card');
  assert.match(t, /\b5\s*m|\b5 min|minutes? ago|\b5m\b/i, 'the age of the newer card');
});

test('quick capture: the title and text become an idea card of the header project, and the list reloads', async () => {
  const app = await inbox();
  const before = app.callsTo('listDiscoveryCards').length;
  app.el('#inbox-title').value = 'Export to CSV';
  app.el('#inbox-text').value = 'From the reports screen.';
  await app.click('#inbox-capture');
  const call = app.callsTo('createDiscoveryCard')[0];
  assert.ok(call, 'createDiscoveryCard was not called');
  const a = argsOf(call, ['projectId', 'title', 'text']);
  assert.equal(a.projectId, 'p1');
  assert.equal(a.title, 'Export to CSV');
  assert.equal(a.text, 'From the reports screen.');
  assert.ok(app.callsTo('listDiscoveryCards').length > before, 'the list was not reloaded');
});

test('Accept on a row moves the card to the triage column', async () => {
  const app = await inbox();
  await app.click('#inbox-list', { dataset: { action: 'accept', card: '20261004-bbbb' } });
  const call = app.callsTo('moveDiscoveryCard')[0];
  assert.ok(call, 'moveDiscoveryCard was not called');
  const a = argsOf(call, ['projectId', 'cardId', 'column']);
  assert.equal(a.projectId, 'p1');
  assert.equal(a.cardId, '20261004-bbbb');
  assert.equal(a.column, 'triage');
});

// ---- capture with files, keys, and the open card (#256, after the code) ---------------------------

// A FileReader that reads a fake file ({ name, size, b64 }) as a data: URL, like the browser's.
const FILE_READER = "window.FileReader = class { readAsDataURL(f) { this.result = 'data:application/octet-stream;base64,' + f.b64; setTimeout(() => this.onload()); } }";
const keydown = (app, sel, extra) => app.el(sel).dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
// an object made in the page's realm, comparable with this file's literals
const plain = (v) => JSON.parse(JSON.stringify(v));
const OPEN = { ...CARDS[1], document: 'The newer document.', acceptance: '', history: [], attachments: ['a.png'] };

async function openCard(api = {}) {
  const app = await inbox({ getDiscoveryCard: async () => OPEN, discoveryConversation: async () => [], ...api });
  await app.click('#inbox-list', { dataset: { action: 'open', card: OPEN.id } });
  await app.settle(10);
  return app;
}

test('capture with a pasted file: the card is created, then the file is attached by its name and base64 data', async () => {
  const app = await inbox();
  app.run(FILE_READER);
  app.el('#inbox-title').dispatchEvent({ type: 'paste', clipboardData: { files: [{ name: 'shot.png', size: 3, b64: 'cG5n' }] }, preventDefault() {} });
  await app.settle(10);
  app.el('#inbox-title').value = 'With a screenshot';
  await app.click('#inbox-capture');
  await app.settle(10);
  assert.ok(app.callsTo('createDiscoveryCard')[0], 'createDiscoveryCard was not called');
  const attach = app.callsTo('addDiscoveryAttachment');
  assert.equal(attach.length, 1);
  assert.deepEqual(attach[0], ['p1', '20261004-cccc', undefined, 'shot.png', 'cG5n']);
});

test('capture with a dropped file attaches it too; a file over 50 MB is named in an error and not attached', async () => {
  const app = await inbox();
  app.run(FILE_READER);
  const drop = (files) => app.el('#inbox-capture-box').dispatchEvent({ type: 'drop', dataTransfer: { files, types: ['Files'] }, preventDefault() {} });
  drop([{ name: 'spec.pdf', size: 4, b64: 'JVBERg==' }, { name: 'huge.mov', size: 51 * 1024 * 1024, b64: '' }]);
  await app.settle(10);
  assert.match(app.el('#inbox-capture-error').textContent, /huge\.mov/);
  app.el('#inbox-title').value = 'Dropped';
  await app.click('#inbox-capture');
  await app.settle(10);
  assert.deepEqual(app.callsTo('addDiscoveryAttachment').map((a) => a[3]), ['spec.pdf']);
});

test('an empty title shows an error and creates nothing', async () => {
  const app = await inbox();
  app.el('#inbox-title').value = '   ';
  app.el('#inbox-text').value = 'Some text';
  await app.click('#inbox-capture');
  assert.equal(app.callsTo('createDiscoveryCard').length, 0);
  assert.match(app.el('#inbox-capture-error').textContent, /title/i);
});

test('Enter in the title or the text captures; Shift+Enter does not', async () => {
  const app = await inbox();
  app.el('#inbox-title').value = 'Typed';
  keydown(app, '#inbox-text', { shiftKey: true });
  await app.settle(10);
  assert.equal(app.callsTo('createDiscoveryCard').length, 0, 'Shift+Enter captured');
  keydown(app, '#inbox-text');
  await app.settle(10);
  assert.equal(app.callsTo('createDiscoveryCard').length, 1);
  app.el('#inbox-title').value = 'Typed again';
  keydown(app, '#inbox-title');
  await app.settle(10);
  assert.equal(app.callsTo('createDiscoveryCard').length, 2);
});

test('opening a card shows its document, its attachments and the triage actions', async () => {
  const app = await openCard();
  const call = app.callsTo('getDiscoveryCard')[0];
  assert.deepEqual(argsOf(call, ['projectId', 'cardId']), { projectId: 'p1', cardId: OPEN.id });
  const t = text(allMarkup(app));
  assert.match(t, /The newer document\./);
  assert.match(t, /a\.png/);
  for (const action of ['Accept', 'Merge into', 'Discard']) assert.match(t, new RegExp(action));
});

test('Merge into…: the dialog lists the other cards, and confirming merges the open card into the chosen one', async () => {
  const app = await openCard();
  await app.click('#inbox-detail', { dataset: { detail: 'merge' } });
  await app.settle(10);
  const options = app.el('#inbox-merge-target').innerHTML;
  assert.match(options, /Older idea/);
  assert.doesNotMatch(options, /Newer idea/, 'a card cannot be merged into itself');
  app.el('#inbox-merge-target').value = '20261004-aaaa';
  await app.el('#inbox-merge-form').onsubmit({ preventDefault() {} });
  await app.settle(10);
  assert.deepEqual(app.callsTo('mergeDiscoveryCard')[0], ['p1', OPEN.id, '20261004-aaaa']);
});

test('Discard asks for a reason: none shows an error, a reason archives the card with it', async () => {
  const app = await openCard();
  await app.click('#inbox-detail', { dataset: { detail: 'discard' } });
  app.el('#inbox-discard-reason').value = '  ';
  await app.el('#inbox-discard-form').onsubmit({ preventDefault() {} });
  assert.equal(app.callsTo('archiveDiscoveryCard').length, 0);
  assert.match(app.el('#inbox-discard-error').textContent, /why|reason/i);
  app.el('#inbox-discard-reason').value = 'Out of scope';
  await app.el('#inbox-discard-form').onsubmit({ preventDefault() {} });
  await app.settle(10);
  assert.deepEqual(app.callsTo('archiveDiscoveryCard')[0], ['p1', OPEN.id, 'Out of scope']);
});

test('Edit: Save writes the title and document; an edit with changes blocks Accept until it is saved or cancelled', async () => {
  const app = await openCard();
  await app.click('#inbox-detail', { dataset: { detail: 'edit' } });
  app.el('#inbox-edit-title').value = OPEN.title;
  app.el('#inbox-edit-doc').value = 'An edited document.';
  await app.click('#inbox-detail', { dataset: { detail: 'accept' } });
  assert.equal(app.callsTo('moveDiscoveryCard').length, 0, 'Accept dropped an unsaved edit');
  assert.match(app.el('#inbox-detail-error').textContent, /save or cancel/i);
  await app.click('#inbox-detail', { dataset: { detail: 'save' } });
  await app.settle(10);
  assert.deepEqual(plain(app.callsTo('updateDiscoveryCard')[0]), ['p1', OPEN.id, { title: OPEN.title, document: 'An edited document.' }]);
});

test('adding a note appends it to the card\'s thread; removing an attachment asks first, then removes it', async () => {
  const app = await openCard();
  app.el('#inbox-note').value = 'Asked the team.';
  await app.click('#inbox-detail', { dataset: { detail: 'note' } });
  await app.settle(10);
  assert.deepEqual(plain(app.callsTo('appendDiscoveryConversation')[0]), ['p1', OPEN.id, { text: 'Asked the team.' }]);

  await app.click('#inbox-detail', { dataset: { detail: 'unattach', name: 'a.png' } });
  assert.equal(app.callsTo('removeDiscoveryAttachment').length, 0, 'removed without asking');
  await app.click('#btn-confirm-yes');
  await app.settle(10);
  assert.deepEqual(app.callsTo('removeDiscoveryAttachment')[0], ['p1', OPEN.id, 'a.png']);
});
