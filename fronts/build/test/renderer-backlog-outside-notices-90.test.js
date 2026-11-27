// #90 (review round 3), the screens' notices about outside issues, through the whole page (agent-chat-page-harness):
// - the Backlog's error line (#bl-error) says the authors could not be read (data.authorsError, whose sync marks
//   new issues Outside), next to the PRs' read error (' · '), and is hidden when nothing failed;
// - the Product Owner's "Add all to the roadmap" note names the outside issues the roadmap left out for the owner's
//   approval (roadmap:propose's awaitingOwner).
// The Roadmap's Propose error line is in renderer-roadmap-clicks-432.test.js. Assertions compare strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const en = require('@craftorio/shared/i18n/en.json');
const { openDrawer, recommendation, click } = require('./backlog-po-785-harness');

const PROJECTS = [{ id: 'p1', name: 'demo', folder: 'C:/demo', repo: 'https://github.com/o/r' }];
const data = (over = {}) => ({ projectId: 'p1', platform: 'github', repo: 'https://github.com/o/r', syncedAt: '2026-11-27T10:00:00.000Z', issues: [], epics: [], ...over });
const AUTHORS = en['backlog.authors_could_not_be_read'];

async function backlogPage(answer) {
  const page = await loadPage({
    api: { listProjects: async () => PROJECTS, listPipelines: async () => [], listWorkflows: async () => [], getBacklog: async () => JSON.parse(JSON.stringify(answer)), syncBacklog: async () => JSON.parse(JSON.stringify(answer)) },
  });
  page.run("showView('backlog')");
  await settle(30);
  return page;
}
const errorLine = (page) => String(page.$('#bl-error')?.textContent || '');
const errorHidden = (page) => page.$('#bl-error')?.classList.contains('hidden') === true;

test('#90 the Backlog says the authors could not be read, with the reason', async () => {
  const page = await backlogPage(data({ authorsError: 'gh api graphql failed' }));
  assert.deepEqual([errorLine(page).includes(AUTHORS), errorLine(page).includes('gh api graphql failed'), errorHidden(page)], [true, true, false]);
});

test('#90 the authors notice follows the PRs\' read error, after a " · "', async () => {
  const page = await backlogPage(data({ authorsError: 'gh api graphql failed', pullRequestsError: 'gh pr list failed' }));
  const line = errorLine(page);
  assert.deepEqual([line.indexOf('gh pr list failed') >= 0, line.indexOf(` · ${AUTHORS}`) > line.indexOf('gh pr list failed')], [true, true]);
});

test('#90 with no read error the Backlog\'s error line is empty and hidden', async () => {
  const page = await backlogPage(data());
  assert.deepEqual([errorLine(page), errorHidden(page)], ['', true]);
});

// ---- the Product Owner's "Add all to the roadmap" ---------------------------------------------------------

test('#90 "Add all to the roadmap" names the outside issues waiting for the owner\'s approval', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: recommendation(), api: { proposeRoadmap: async () => ({ roadmap: { state: 'planned', stages: [] }, dropped: [], awaitingOwner: [7, 9] }) } });
  await click(page, page.$('#po-log [data-po-act="roadmap-all"]'), '"Add all to the roadmap"');
  const text = String(textOf(page.$('#po-log')) || '');
  assert.equal(text.includes('Waiting for your approval in the Backlog: #7, #9'), true, text);
});

test('#90 "Add all to the roadmap" says nothing about approval when no outside issue waits', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: recommendation(), api: { proposeRoadmap: async () => ({ roadmap: { state: 'planned', stages: [] }, dropped: [], awaitingOwner: [] }) } });
  await click(page, page.$('#po-log [data-po-act="roadmap-all"]'), '"Add all to the roadmap"');
  const text = String(textOf(page.$('#po-log')) || '');
  assert.deepEqual([text.includes('Added to the roadmap as planned.'), text.includes('Waiting for your approval')], [true, false]);
});
