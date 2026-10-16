// src/renderer/views/sessions/sessions.js: the "Open terminals" list's hover pencil (rename) and
// trash can (close), #54. It runs only inside the Electron renderer (document, window.api), so the
// rename logic is pulled out of the source and evaluated in a sandbox, the way
// test/renderer-run-chat.test.js checks run-chat.js as a seam; the markup itself (itemHtml) is
// checked as source text, the way test/renderer-backlog-assign.test.js checks backlog.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'sessions', 'sessions.js'), 'utf8');

test('itemHtml: every item shows a pencil and a trash can, not only a resumed CLI session', () => {
  // the Open terminals loop: rename/close are passed for every tab, unconditionally (no `t.kind === 'cli-resume' ? ... : null` gate)
  const openTerminals = /if \(sx\.tabs\.length\) \{[\s\S]*?\n {4}\}/.exec(src)[0];
  assert.match(openTerminals, /rename: `data-rename-tab="\$\{esc\(t\.key\)\}"`, close: t\.key,/);
  assert.doesNotMatch(openTerminals, /cli-resume['"]\s*\?/, 'no kind check gating the pencil to resumed sessions only');

  const itemHtml = /function itemHtml\(\{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(itemHtml, /class="icon-btn sx-item-rename"/);
  assert.match(itemHtml, /class="icon-btn sx-item-close"/);
  assert.match(itemHtml, /aria-label="\$\{t\('sessions\.rename'\)\}"/);
  assert.match(itemHtml, /aria-label="\$\{t\(exited \? 'common\.close' : 'sessions\.end_session'\)\}"/);
  // both icons sit together so hover/focus-within reveals them as one group (sessions.css)
  assert.match(itemHtml, /sx-item-actions/);
});

test('clicking a pencil or trash can never opens/selects the item', () => {
  const onOpen = /const onOpen = \(el, fn\) => \{[\s\S]*?\n {4}\};/.exec(src)[0];
  assert.match(onOpen, /e\.target\.closest\('\.sx-item-actions, \.sx-title-input'\)/);
});

function loadHelpers() {
  const resumeKey = /const resumeKey = [^\n]+/.exec(src)[0];
  const editSessionTitle = /function editSessionTitle\(el, provider, id\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const editTabTitle = /function editTabTitle\(el, tab\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const renameRecorded = /async function renameRecorded\(tab, title\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const applyPendingTitle = /function applyPendingTitle\(tab, s\) \{[\s\S]*?\n  \}/.exec(src)[0];
  for (const [name, code] of Object.entries({ resumeKey, editSessionTitle, editTabTitle, renameRecorded, applyPendingTitle })) {
    assert.ok(code, `${name} not found in sessions.js: the source moved`);
  }

  const renamed = [];
  const sandbox = {
    sx: { sessions: [], tabs: [] },
    api: { renameCliSession: async (provider, id, title) => { renamed.push({ provider, id, title }); return { title, renamed: title !== '' }; } },
    flash: () => {},
    renderList: () => {},
    errMsg: (e) => String(e?.message || e),
    // captures editTitle(el, current, save): a test calls the captured `save` itself, standing in
    // for the user typing a title and pressing Enter (editTitle's own DOM wiring needs no test here)
    editTitle: (el, current, save) => { sandbox.lastEdit = { el, current, save }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${resumeKey}\n${editSessionTitle}\n${editTabTitle}\n${renameRecorded}\n${applyPendingTitle}\n`
    + 'this.helpers = { editTabTitle, editSessionTitle, applyPendingTitle, renameRecorded, resumeKey };',
    sandbox,
  );
  return { sandbox, renamed, helpers: sandbox.helpers };
}

test('editTabTitle: a new session not yet recorded renames its tab now and keeps the name pending', async () => {
  const { sandbox, renamed } = loadHelpers();
  const tab = { kind: 'cli-new', title: 'New Claude session · project', opts: {} };
  sandbox.helpers.editTabTitle('el', tab);
  assert.equal(sandbox.lastEdit.current, tab.title, 'the editor opens with the tab\'s current title');
  await sandbox.lastEdit.save('My review');
  assert.equal(tab.title, 'My review', 'the tab is renamed right away');
  assert.equal(tab.pendingTitle, 'My review', 'the name is not lost: applied once the CLI records the session');
  assert.deepEqual(renamed, [], 'not recorded yet: no CLI session to rename');
});

test('editTabTitle: an empty title on a not-yet-recorded session reverts to its first title and clears the pending rename', async () => {
  const { sandbox } = loadHelpers();
  const tab = { kind: 'cli-new', title: 'New Claude session · project' };
  sandbox.helpers.editTabTitle('el', tab);
  await sandbox.lastEdit.save('');
  assert.equal(tab.title, 'New Claude session · project');
  assert.equal(tab.pendingTitle, null);
});

test('applyPendingTitle: linkTabs gives the session its pending name right away (it keeps it meanwhile) and clears the pending flag', () => {
  const { sandbox } = loadHelpers();
  const tab = { kind: 'cli-new', title: 'New Claude session · project', opts: { provider: 'claude', sessionId: 's1' }, pendingTitle: 'My review' };
  const s = { provider: 'claude', id: 's1', title: '(no prompt)' };
  sandbox.sx.sessions = [s];
  sandbox.helpers.applyPendingTitle(tab, s);
  assert.equal(s.title, 'My review');
  assert.equal(tab.pendingTitle, null, 'consumed once applied');
});

test('renameRecorded: renames the recorded CLI session through the API and updates the session and the tab', async () => {
  const { sandbox, renamed } = loadHelpers();
  const tab = { kind: 'cli-new', title: 'New Claude session · project', opts: { provider: 'claude', sessionId: 's1' } };
  const s = { provider: 'claude', id: 's1', title: '(no prompt)' };
  sandbox.sx.sessions = [s];
  await sandbox.helpers.renameRecorded(tab, 'My review');
  assert.deepEqual(renamed, [{ provider: 'claude', id: 's1', title: 'My review' }]);
  assert.equal(s.title, 'My review');
  assert.equal(tab.title, 'My review');
});

test('editTabTitle: a recorded CLI session (cli-resume) renames the session itself, not just the tab label', async () => {
  const { sandbox, renamed } = loadHelpers();
  const tab = { kind: 'cli-resume', title: 'old title', opts: { provider: 'codex', sessionId: 'abc' } };
  sandbox.sx.sessions = [{ provider: 'codex', id: 'abc', title: 'old title' }];
  sandbox.sx.tabs = [tab];
  sandbox.helpers.editTabTitle('el', tab);
  await sandbox.lastEdit.save('renamed session');
  assert.deepEqual(renamed, [{ provider: 'codex', id: 'abc', title: 'renamed session' }]);
});

test('editTabTitle: any other terminal (live log follower, supervisor chat) only renames its tab label', async () => {
  const { sandbox, renamed } = loadHelpers();
  const tab = { kind: 'supervisor', title: 'supervisor' };
  sandbox.helpers.editTabTitle('el', tab);
  await sandbox.lastEdit.save('watching run 42');
  assert.equal(tab.title, 'watching run 42');
  assert.equal(tab.pendingTitle, undefined, 'only a not-yet-recorded CLI session gets a pending rename');
  assert.deepEqual(renamed, [], 'no CLI session to rename for this kind of terminal');
});
