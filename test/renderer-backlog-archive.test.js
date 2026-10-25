// #238: archive issues from the Backlog screen. Acceptance tests, written before the code.
//
// Seams this file expects:
// 1. A new plain-logic module, no DOM: packages/shared/backlog-archive.js (moved from views/backlog/, #345)
//    (Browser: window.BacklogArchive, loaded by src/renderer/index.html; Node: module.exports, like
//    backlog-labels.js; the service may require it too, as packages/engine/domains/roadmap/roadmap.js requires chain-model):
//      ARCHIVED_LABEL                         'archived'
//      isArchived(issue)                      closed and labelled `archived` (any case)
//      issueState(issue)                      'open' | 'closed' | 'archived' (the state chips)
//      archiveBlockReason(issue)              null, or why it cannot be archived: a planned or running
//                                             roadmap item ("Planned in stage 41: remove it from the
//                                             roadmap first") or a run in progress (`runs` status running)
//      archiveConfirmText(numbers, platform)  "Close #12, #15 as not planned on GitHub and label them archived?"
//      deprioritizedIssues(issues)            the open issues still labelled with the retired `deprioritized`
// 2. src/renderer/views/backlog/backlog.js (renderer-only, checked as source like
//    test/renderer-backlog-filters.test.js): an "Archive (n)" button in the selection bar
//    (#btn-bl-archive, next to Send to Product Owner), an Archive action on each list row and kanban
//    card (data-archive, disabled with archiveBlockReason as its tooltip), a fourth state chip
//    Archived, Restore (data-restore) on archived issues, calls to api.archiveIssues /
//    api.restoreIssues (channels in test/service/backlog-archive.test.js), and a banner for the
//    issues still labelled `deprioritized`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const en = require('@multiagent/shared/i18n/en.json');

const VIEW = path.join(__dirname, '..', 'src', 'renderer', 'views', 'backlog');
const src = fs.readFileSync(path.join(VIEW, 'backlog.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

function loadArchive() {
  // moved to packages/shared/ with the other pure modules both sides use (#345)
  const file = path.join(__dirname, '..', 'packages', 'shared', 'backlog-archive.js');
  assert.ok(fs.existsSync(file), 'packages/shared/backlog-archive.js exists');
  return require(file);
}

const issue = (number, state, labels = [], extra = {}) => ({ number, title: `Issue ${number}`, state, labels: labels.map((name) => ({ name, color: null })), runs: [], ...extra });

// The top-level definitions of the view (functions and consts, indented by two spaces in its IIFE),
// by name: a row or card may draw its Archive action through a helper.
const chunks = src.split(/\n {2}(?=(?:async function|function|const|let) )/).map((text) => ({ name: (/^(?:async function|function|const|let) (\w+)/.exec(text) || [])[1], text }));
const chunk = (name) => chunks.find((c) => c.name === name)?.text || '';
const drawsArchive = (body, seen = new Set()) => {
  if (/data-archive\b/.test(body)) return true;
  return chunks.some((c) => c.name && !seen.has(c.name) && new RegExp(`\\b${c.name}\\(`).test(body) && /data-archive\b/.test(c.text) && (seen.add(c.name), true));
};
const archiveDrawer = () => chunks.find((c) => /data-archive\b/.test(c.text) && !['issueRow', 'card'].includes(c.name))?.text || chunks.find((c) => /data-archive\b/.test(c.text))?.text || '';

// ---- the plain logic --------------------------------------------------------------------------------

test('backlog-archive: an archived issue is closed and labelled `archived`; the label alone, or closed alone, is not archived', () => {
  const { ARCHIVED_LABEL, isArchived } = loadArchive();
  assert.equal(ARCHIVED_LABEL, 'archived');
  assert.equal(isArchived(issue(1, 'closed', ['archived'])), true);
  assert.equal(isArchived(issue(2, 'closed', ['bug', 'Archived'])), true, 'names compare in any case');
  assert.equal(isArchived(issue(3, 'closed', ['bug'])), false);
  assert.equal(isArchived(issue(4, 'open', ['archived'])), false);
  assert.equal(isArchived(issue(5, 'closed', ['archived-2025'])), false, 'whole names, not substrings');
});

test('backlog-archive: issueState gives the four chips their issues: open, closed (not archived), archived', () => {
  const { issueState } = loadArchive();
  assert.equal(issueState(issue(1, 'open')), 'open');
  assert.equal(issueState(issue(2, 'open', ['archived'])), 'open');
  assert.equal(issueState(issue(3, 'closed', ['bug'])), 'closed');
  assert.equal(issueState(issue(4, 'closed', ['archived'])), 'archived');
});

test('backlog-archive: archiveBlockReason refuses a planned or running roadmap item (naming its stage) and an issue with a run in progress', () => {
  const { archiveBlockReason } = loadArchive();
  assert.equal(archiveBlockReason(issue(7, 'open', [], { roadmap: { stage: 41, name: 'Stage 41', status: 'planned', itemId: 'x' } })), 'Planned in stage 41: remove it from the roadmap first');
  const running = archiveBlockReason(issue(8, 'open', [], { roadmap: { stage: 3, name: 'Polish', status: 'running', itemId: 'y' } }));
  assert.match(running, /stage 3/);
  assert.match(running, /roadmap/);
  const withRun = archiveBlockReason(issue(9, 'open', [], { runs: [{ runId: '20261004-010101-abcd1234', status: 'running', mock: false }] }));
  assert.equal(typeof withRun, 'string');
  assert.match(withRun, /\brun\b/i);
  // nothing in progress: archivable
  assert.equal(archiveBlockReason(issue(10, 'open')), null);
  assert.equal(archiveBlockReason(issue(11, 'open', [], { roadmap: { stage: 1, name: 'Stage 1', status: 'done', itemId: 'z' }, runs: [{ runId: 'r', status: 'success' }] })), null);
  assert.equal(archiveBlockReason(issue(12, 'open', [], { roadmap: { stage: 2, name: 'Stage 2', status: 'skipped', itemId: 'w' }, runs: [{ runId: 'r', status: 'failed' }] })), null);
});

test('backlog-archive: the confirm names the issues and what happens on the platform', () => {
  const { archiveConfirmText } = loadArchive();
  assert.equal(archiveConfirmText([12, 15], 'github'), 'Close #12, #15 as not planned on GitHub and label them archived?');
  const one = archiveConfirmText([12], 'github');
  assert.equal(one, 'Close #12 as not planned on GitHub and label it archived?');
  const gl = archiveConfirmText([12, 15], 'gitlab');
  assert.match(gl, /#12, #15/);
  assert.match(gl, /GitLab/);
  assert.match(gl, /label them archived/);
  assert.doesNotMatch(gl, /not planned/, 'GitLab has no close reason');
});

test('backlog-archive: deprioritizedIssues lists the open issues still labelled with the retired `deprioritized`', () => {
  const { deprioritizedIssues } = loadArchive();
  const list = [issue(1, 'open', ['deprioritized']), issue(2, 'open', ['bug']), issue(3, 'closed', ['deprioritized']), issue(4, 'open', ['Deprioritized', 'bug'])];
  assert.deepEqual(deprioritizedIssues(list).map((i) => i.number), [1, 4]);
  assert.deepEqual(deprioritizedIssues([]), []);
});

// ---- the screen (source seams) ----------------------------------------------------------------------

test('index.html loads backlog-archive.js with the other shared modules', () => {
  assert.match(indexHtml, /<script src="\.\.\/\.\.\/packages\/shared\/backlog-archive\.js"><\/script>/);
});

test('selection bar: an "Archive (n)" button next to Send to Product Owner and Clear selection, shown with the selection', () => {
  const markup = /<button id="btn-bl-send-po"[\s\S]*?<button id="btn-bl-clear"/.exec(src)?.[0] || '';
  assert.match(markup, /<button id="btn-bl-archive"[^>]*>\$\{t\('backlog\.archive'\)\}<\/button>/, 'Archive sits between Send to Product Owner and Clear selection');
  assert.equal(en['backlog.archive'], 'Archive');
  assert.match(src, /\$b\('#btn-bl-archive'\)\.classList\.toggle\('hidden', !n\);/);
  assert.match(src, /\$b\('#btn-bl-archive'\)\.textContent = t\('backlog\.archive_n', \{ n \}\);/);
  assert.equal(en['backlog.archive_n'], 'Archive ({n})');
});

test('Archive asks first with the confirm naming the issues, then calls api.archiveIssues for the project', () => {
  assert.match(src, /confirmDialog\([^\n]*archiveConfirmText\(/, 'the confirm text comes from archiveConfirmText');
  assert.match(src, /api\.archiveIssues\(bl\.projectId, /);
});

test('each list row and each kanban card has an Archive action (data-archive)', () => {
  assert.ok(chunk('issueRow'), 'issueRow found');
  assert.ok(chunk('card'), 'card found');
  assert.ok(drawsArchive(chunk('issueRow')), 'the list row draws an Archive action');
  assert.ok(drawsArchive(chunk('card')), 'the kanban card draws an Archive action');
});

test('an issue that cannot be archived has its Archive action disabled, with the reason as its tooltip', () => {
  const body = archiveDrawer();
  assert.ok(body, 'the code drawing data-archive is found');
  assert.match(body, /archiveBlockReason\(/);
  assert.match(body, /disabled/);
  assert.match(body, /title="\$\{esc\(/, 'the reason is shown as an escaped tooltip');
});

test('a fourth state chip Archived; Closed shows the other closed issues (the chips filter through issueState)', () => {
  const filters = /const FILTERS = \[[^\n]*\];/.exec(src)?.[0] || '';
  assert.match(filters, /'open'/);
  assert.equal(en['backlog.filter_open'], 'Open');
  assert.match(filters, /'closed'/);
  assert.equal(en['backlog.filter_closed'], 'Closed');
  assert.match(filters, /'archived'/);
  assert.equal(en['backlog.filter_archived'], 'Archived');
  const inState = /const inState = [^\n]*/.exec(src)?.[0] || '';
  assert.match(inState, /issueState\(i\)/, 'the state filter compares issueState, so archived issues leave Closed');
  assert.doesNotMatch(inState, /i\.state === bl\.filter/);
});

test('archived issues have Restore (data-restore), which calls api.restoreIssues for the project', () => {
  assert.match(src, /data-restore="\$\{i\.number\}"/);
  assert.match(src, />\$\{t\('backlog\.restore'\)\}</);
  assert.equal(en['backlog.restore'], 'Restore');
  assert.match(src, /api\.restoreIssues\(bl\.projectId, /);
});

// ---- the issue's ⋯ menu (change request 1) -----------------------------------------------------------

test('the ⋯ menu holds Enrich in Write & Review above Archive; rows and cards draw Enrich only through the menu', () => {
  const menu = chunk('issueMenu');
  assert.ok(menu, 'issueMenu found');
  const enrichAt = menu.search(/role="menuitem" data-enrich="\$\{i\.number\}"/);
  const archiveAt = menu.search(/role="menuitem" data-archive="\$\{i\.number\}"/);
  assert.ok(enrichAt >= 0, 'Enrich is a menu item');
  assert.ok(archiveAt > enrichAt, 'Enrich sits above Archive');
  assert.match(menu, /data-testid="backlog-enrich"/);
  assert.match(menu, />\$\{t\('backlog\.enrich_in_write_review'\)\}</);
  assert.equal(en['backlog.enrich_in_write_review'], 'Enrich in Write &amp; Review');
  // the separate link is gone: Enrich appears in the view only inside the menu
  const drawers = chunks.filter((c) => /data-enrich="/.test(c.text)).map((c) => c.name);
  assert.deepEqual(drawers, ['issueMenu']);
  assert.doesNotMatch(chunk('issueRow'), /data-enrich/);
  assert.doesNotMatch(chunk('card'), /data-enrich/);
});

test('choosing Enrich closes the menu, then opens Write & Review for the issue', () => {
  // #375 shares these lines with the Show on the map dispatch (the file's line budget)
  const handler = /const enrich = e\.target\.closest\('\[data-enrich\]'\)[\s\S]*?if \(enrich\) \{([^\n}]*)\}/.exec(src)?.[1] || '';
  assert.ok(handler, 'the Enrich click handler is found');
  assert.match(handler, /bl\.menu = null/);
  assert.match(handler, /enrichIssue\(Number\(enrich\.dataset\.enrich\)\)/);
});

test('a list row ends with the issue menu (or Restore) instead of the expand chevron', () => {
  const row = chunk('issueRow');
  assert.doesNotMatch(row, /[▸▾]/, 'no chevron left in the row');
  assert.doesNotMatch(src, /[▸▾]/, 'no chevron anywhere in the view');
  // the menu is the row head's last cell
  const head = /<div class="bl-row"[\s\S]*?\n {8}<\/div>/.exec(row)?.[0] || '';
  assert.match(head, /<span class="bl-actions">\$\{issueMenu\(i\)\}<\/span>\s*<\/div>$/);
});

test('a kanban card draws its ⋯ menu in the card head, after the title', () => {
  const head = /<div class="bl-card-head">[^\n]*<\/div>/.exec(chunk('card'))?.[0] || '';
  assert.ok(head, 'the card head is found');
  assert.match(head, /bl-card-title[^\n]*\$\{issueMenu\(i\)\}<\/div>$/);
});

test('the deprioritized banner: Dismiss (or archiving from it) is remembered per project', () => {
  assert.match(src, /data-deprioritized-dismiss/);
  assert.match(src, /const deprioritizedKey = \(\) => `\$\{DEPRIORITIZED_KEY\}\.\$\{bl\.projectId\}`/);
  assert.match(src, /load\(deprioritizedKey\(\)\) \? \[\] : deprioritizedIssues\(/, 'once remembered, the banner lists nothing');
  assert.match(src, /\[data-deprioritized-dismiss\]'\)\) \{ save\(deprioritizedKey\(\), '1'\)/);
});

test('issues still labelled `deprioritized` get a one-time banner offering to archive them', () => {
  assert.match(src, /deprioritizedIssues\(/);
  assert.match(src, /deprioritized/);
  // one-time: dismissing it is remembered (the view's load/save storage helpers)
  assert.match(src, /\b(save|load)\([^)\n]*depriorit/i);
});
