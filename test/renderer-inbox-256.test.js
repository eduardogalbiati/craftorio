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
