// Screenshot seed of the Discovery board (--view discovery, #257): the Inbox's cards (views/inbox.js),
// cards in every column and the fast lane (demoDiscoveryBoard), the committed cards
// (demoCommittedCards, #258: also badges on their issues in the Backlog) and the release history they
// follow to the release (views/releases.js); --mode empty: no card, the empty board.

const fs = require('fs');
const path = require('path');
const { solidPng } = require('../helpers');
const { demoDiscovery } = require('./inbox');
const { demoReleases } = require('./releases');

// The Discovery board's cards (#257), next to demoDiscovery's one in Triage: cards in every column,
// a bug (Triage) and a hotfix (Define) in the fast lane, Define over a WIP limit of 2, and in Shape
// a PRD with tags, a clarity score, an estimate, acceptance criteria, an image, notes and a
// Write & Review result (a version and a thread entry).
function demoDiscoveryBoard(ws, projectId) {
  const discovery = require('@multiagent/engine/domains/discovery/discovery');
  const dir = ws.discovery;
  const hour = 3600000;
  const columns = ['triage', 'shape', 'define', 'ready'];
  const card = (hoursAgo, to, { title, text = '', type = 'idea', author = 'maintainer', tags, clarity, gaps = [], estimate, acceptance, anyway }) => {
    const c = discovery.createCard(dir, projectId, { title, text, type, author, tags, column: 'triage' });
    // the score first: a move into Ready goes through the clarity bar (#166), `anyway` is the
    // owner's reason to move a card there below it
    discovery.updateCard(dir, projectId, c.id, { ...(acceptance ? { acceptance } : {}), ...(clarity ? { clarity: { score: clarity, gaps, by: 'Product Owner' } } : {}), ...(estimate ? { estimate } : {}) });
    // a bug or a hotfix takes the fast lane: Triage → Define
    const fast = ['bug', 'hotfix'].includes(type);
    for (const column of columns.slice(1, columns.indexOf(to) + 1)) {
      if (!(fast && column === 'shape')) discovery.moveCard(dir, projectId, c.id, column, { by: author, ...(column === 'ready' && anyway ? { force: true, reason: anyway } : {}) });
    }
    // created and moved in the past, so the cards show different ages
    const file = path.join(dir, projectId, 'cards', c.id, 'card.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = new Date(Date.now() - hoursAgo * hour).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...json, created: at, updated: at, history: json.history.map((h) => ({ ...h, ts: at })) }, null, 2));
    return c.id;
  };
  card(3, 'triage', { title: 'Crash when a run is stopped twice', type: 'bug', author: 'support', text: 'Stopping a run that is already stopping throws in the engine.' });
  const plugin = card(30, 'shape', { title: 'Plugin API for custom steps', type: 'rfc', author: 'marina', tags: ['engine'], text: 'Let a workflow call a step implemented by a workspace plugin.' });
  // #259: the Shape automation runs on this card (Running… on its face); Ready's is turned off
  discovery.markAutomation(dir, projectId, plugin, { runId: '20261011-2210-cd34', name: 'AI Arena → Write & Review', column: 'shape' });
  discovery.setColumnAutomation(dir, projectId, 'ready', { mode: 'off' });
  const report = card(52, 'shape', {
    title: 'Weekly cost report by project', type: 'prd', tags: ['cost', 'reports'], clarity: 62, estimate: { usd: 4.2, minutes: 35 },
    text: ['# Weekly cost report', '', 'A report of what each project spent in the week, sent on Monday morning.', '', '## Open questions', '', '- Per workflow too, or per project only?', '- In the app only, or by e-mail?'].join('\n'),
    acceptance: ['- [ ] One row per project with its runs, cost and tokens of the week', '- [ ] The report opens from the Dashboard on Monday'].join('\n'),
  });
  discovery.addAttachment(dir, projectId, report, { name: 'report-sketch.png', data: solidPng(320, 180, [124, 156, 255]) });
  discovery.appendConversation(dir, projectId, report, { kind: 'note', author: 'maintainer', text: 'The Usage screen has the weekly totals already.', ts: new Date(Date.now() - 50 * hour).toISOString() });
  discovery.recordResult(dir, projectId, report, {
    source: 'write-review', runId: '20261003-1012-ab12', by: 'maintainer',
    text: ['# Weekly cost report by project', '', '## Problem', '', 'The owner compares what each project spent week by week, and today adds the numbers up by hand from the Usage screen.', '',
      '## Goals', '', '- One report per week: runs, cost and tokens per project', '- Opened from the Dashboard on Monday morning', '',
      '## Non-goals', '', '- Budgets and alerts (the spending budget covers them)', '', '## Open questions', '', '- Per workflow too, or per project only?'].join('\n'),
  });
  card(20, 'define', { title: 'Keyboard shortcuts for the Roadmap', author: 'marina', tags: ['ux'], clarity: 88, estimate: { usd: 2.1, minutes: 20 }, text: 'Move an item between stages without the mouse.' });
  card(96, 'define', {
    title: 'Compare two runs side by side', type: 'prd', tags: ['reports'], clarity: 81, text: 'Two runs of the same workflow next to each other: cost, duration, steps.',
    gaps: ['Success metrics: how do we know the comparison is used?', 'Non-goals: is comparing runs of different workflows left out?'],
  });
  card(1, 'define', { title: 'Login loop after the token refresh', type: 'hotfix', author: 'support', text: 'The phone page asks to log in again after every refresh.' });
  // Ready (#166): two cards at or above the bar (the forecast: 19 h, 2 nights of 9 h) and one the
  // owner moved there below it, which the forecast leaves out
  card(140, 'ready', { title: 'Per-project spending budget', type: 'prd', tags: ['cost'], clarity: 94, estimate: { usd: 7.5, minutes: 540 }, text: 'A daily budget per project, next to the workspace one.',
    // #258: criteria in two parts, so the commit dialog proposes two issues
    acceptance: ['## Budget', '- [ ] A daily budget per project in Settings, next to the workspace one', '- [ ] A project that reached its budget starts no new run until the next day', '', '## Reporting', '- [ ] The Usage screen shows what each project spent against its budget', '- [ ] A notice when a project reaches 80% of its budget'].join('\n'),
  });
  card(70, 'ready', { title: 'Retry a failed step from the Run screen', tags: ['engine'], clarity: 90, estimate: { usd: 8.2, minutes: 600 }, text: 'A failed step is retried from its card, without restarting the run.' });
  card(26, 'ready', {
    title: 'Dark theme for the phone page', author: 'marina', tags: ['ux'], clarity: 58, estimate: { usd: 3, minutes: 240 }, text: 'The phone page follows the system theme.',
    gaps: ['Acceptance criteria: which screens of the phone page must follow the theme?', 'Scope: the login page too?'], anyway: 'Needed for Friday\'s demo; the open points are cosmetic.',
  });
  discovery.setWip(dir, projectId, 'define', 2);
}

// The committed cards (#258): one in delivery, filed as two issues of the demo backlog (#12 and #9),
// and one whose issue (#8) the release v0.9 shipped. The Discovery board lists them beside its
// columns with their delivery; the Backlog shows each of these issues with its card's badge.
function demoCommittedCards(ws, projectId) {
  const discovery = require('@multiagent/engine/domains/discovery/discovery');
  const dir = ws.discovery;
  const committed = ({ title, text, acceptance, clarity, issues }) => {
    const c = discovery.createCard(dir, projectId, { title, text, type: 'prd', author: 'maintainer', column: 'triage' });
    discovery.updateCard(dir, projectId, c.id, { acceptance, clarity: { score: clarity, gaps: [], by: 'Product Owner' } });
    for (const column of ['shape', 'define', 'ready']) discovery.moveCard(dir, projectId, c.id, column, { by: 'maintainer' });
    discovery.markCommitted(dir, projectId, c.id, { issues, by: 'maintainer' });
    discovery.appendConversation(dir, projectId, c.id, { kind: 'commit', author: 'maintainer', issues, text: `Committed to the backlog: ${issues.map((n) => `#${n}`).join(', ')}.` });
    return c.id;
  };
  committed({
    title: 'Share a run outside the app', clarity: 92, issues: [12, 9],
    text: ['# Share a run outside the app', '', 'The report of a run leaves the app: exported as Markdown, and checked by a monitor through a health endpoint.'].join('\n'),
    acceptance: ['- [ ] The run report is exported as Markdown', '- [ ] A /health endpoint answers while the server runs'].join('\n'),
  });
  committed({
    title: 'A reference of the workflow YAML for new users', clarity: 88, issues: [8],
    text: 'New users read one page that lists every key of a workflow file, with an example.',
    acceptance: '- [ ] Every key of the workflow YAML is documented with an example',
  });
}

function seed({ args, ws, project }) {
  demoReleases(ws, project.id);
  if (args.mode === 'empty') return;
  demoDiscovery(ws, project.id);
  demoDiscoveryBoard(ws, project.id);
  demoCommittedCards(ws, project.id);
}

module.exports = {
  demoCommittedCards,
  modes: ['empty'],
  seed,
};
