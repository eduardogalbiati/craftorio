// #568 the project page's "Platform triggers" card (fronts/build/views/projects/project-triggers.js): the
// rules, the ignored ones, the switch's state, the last event seen and, when that event's run could not
// start, why (project-triggers-last-error). The real card in a sandbox, read from the box's HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox.js');
const { read, esc } = require('@multiagent/ui-kit/test/page-pieces');

async function render(status) {
  const box = { innerHTML: '' };
  const sandbox = { console, esc, api: { triggersStatus: async () => status } };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('views', 'projects', 'project-triggers.js'), sandbox);
  await sandbox.window.ProjectTriggers.show({ id: 'acme-app' }, box);
  return String(box.innerHTML);
}

const RULE = { on: 'issue_labeled', label: 'ready', mention: null, branch: null, workflow: 'feature' };
const EVENT = { id: 'gh:labeled:9001', kind: 'issue_labeled', url: 'https://github.com/acme/app/issues/42', at: '2026-11-15T10:00:00.000Z', matched: true };
const base = (over = {}) => ({ enabled: true, intervalMs: 120000, rules: [RULE], refused: [], problems: [], lastEvent: null, lastError: null, runs: [], ...over });

test('#568 the card shows why the last event\'s run could not start', async () => {
  const html = await render(base({ lastEvent: { ...EVENT, error: 'workflow file missing' } }));
  assert.match(html, /data-testid="project-triggers-last-error"/);
  assert.match(html, /The run could not start: workflow file missing/);
});

test('#568 the card has no start error when the last event started its run', async () => {
  const html = await render(base({ lastEvent: EVENT, runs: [{ eventId: EVENT.id, runId: '20261115-100000-abcd1234', workflow: 'feature', at: EVENT.at }] }));
  assert.doesNotMatch(html, /project-triggers-last-error/);
  assert.match(html, /20261115-100000-abcd1234/);
});

test('#568 the start error is escaped', async () => {
  const html = await render(base({ lastEvent: { ...EVENT, error: '<img src=x onerror=alert(1)>' } }));
  assert.doesNotMatch(html, /<img/);
});

test('#568 the card is empty when the repository declares no trigger', async () => {
  const html = await render(base({ rules: [], refused: [] }));
  assert.equal(html, '');
});

test('#568 the card says the triggers are off when the interval is 0', async () => {
  const html = await render(base({ intervalMs: 0 }));
  assert.match(html, /data-testid="project-triggers-state" data-state="off"/);
});
