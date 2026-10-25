// Screenshot seed of the Inbox (--view inbox, #256): demo discovery cards (demoDiscovery, also on the
// Discovery board and Home); --mode empty: none, the empty state.

const fs = require('fs');
const path = require('path');
const { solidPng } = require('../helpers');

// The Inbox's discovery cards (#256): three ideas in the Inbox (the newest with an image, a CSV and
// two notes; one from another author; one with a long title, an audio file and a PDF) and one
// already in Triage (a target for Merge into…).
function demoDiscovery(ws, projectId) {
  const discovery = require('../../../src/domains/discovery/discovery');
  const min = 60000;
  const card = (minsAgo, author, title, text, column) => {
    const c = discovery.createCard(ws.discovery, projectId, { title, text, author, column });
    // created in the past, so the list shows different ages
    const file = path.join(ws.discovery, projectId, 'cards', c.id, 'card.json');
    const at = new Date(Date.now() - minsAgo * min).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), created: at, updated: at }, null, 2));
    return c.id;
  };
  card(6 * 24 * 60, 'maintainer', 'Guided setup wizard', 'A first-run wizard that checks the CLIs and creates the first project.', 'triage');
  const call = card(2 * 24 * 60, 'support', 'Customer call: onboarding takes too long, people give up at the CLI install step before they ever start a run',
    'Three customers this week stopped at the CLI install step. The recording and the notes are attached.');
  discovery.addAttachment(ws.discovery, projectId, call, { name: 'call-2026-10-02.m4a', data: Buffer.from('demo audio') });
  discovery.addAttachment(ws.discovery, projectId, call, { name: 'call-notes.pdf', data: Buffer.from('%PDF-1.4 demo') });
  const dark = card(3 * 60, 'marina', 'Dark mode for the run log', 'The run log is hard to read at night: follow the app theme.');
  // a question waiting for the owner (Home's "What needs you", #255)
  discovery.appendConversation(ws.discovery, projectId, dark, { kind: 'question', author: 'grill-me', text: 'Should the log follow the app theme, or get its own switch?', ts: new Date(Date.now() - 40 * min).toISOString() });
  const csv = card(5, 'maintainer', 'Export the night\'s runs as CSV', [
    'The owner wants a spreadsheet of the night\'s runs: the morning summary is read on the phone, the numbers are compared in a spreadsheet.', '',
    '## Open questions', '', '- Which columns: cost, duration, status, issue?', '- One file per night or per week?',
  ].join('\n'));
  discovery.addAttachment(ws.discovery, projectId, csv, { name: 'runs-table.png', data: solidPng(320, 180, [124, 156, 255]) });
  discovery.addAttachment(ws.discovery, projectId, csv, { name: 'night-2026-10-03.csv', data: Buffer.from('run,status,cost_usd\n20261003-2210,success,1.84\n') });
  discovery.appendConversation(ws.discovery, projectId, csv, { kind: 'note', author: 'maintainer', text: 'Asked for it twice this month.', ts: new Date(Date.now() - 4 * min).toISOString() });
  discovery.appendConversation(ws.discovery, projectId, csv, { kind: 'note', author: 'marina', text: 'The Analytics screen already has the numbers: reuse its query.', ts: new Date(Date.now() - 2 * min).toISOString() });
}

function seed({ args, ws, project }) {
  if (args.mode !== 'empty') demoDiscovery(ws, project.id);
}

module.exports = {
  demoDiscovery,
  modes: ['empty'],
  seed,
};
