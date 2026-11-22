// #810 the Run screen's PR monitor card (fronts/build/views/runchat/pr-monitor-card.js renderRun): the Merge /
// Merge ignoring protection / Close buttons act on a live run only. A run stopped or ended while it waited in the
// monitor shows the card (its lines, what blocks the merge) with no button. The real pr-card.js and
// pr-monitor-card.js in a sandbox, the card read from the box's HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');
const { read, esc } = require('@craftorio/ui-kit/test/page-pieces');

function load() {
  const box = { dataset: {}, classList: { toggle() {} }, innerHTML: '' };
  const sandbox = {
    console,
    esc,
    TimeZone: { formatTime: () => '10:00', current: () => 'UTC' },
    document: { addEventListener() {}, getElementById: (id) => (id === 'run-pr-monitor' ? box : null) },
  };
  sandbox.window = sandbox;
  vm.createContext(withI18n(sandbox));
  vm.runInContext(read('..', '..', '..', 'packages', 'shared', 'pr-card.js'), sandbox);
  vm.runInContext(read('views', 'runchat', 'pr-monitor-card.js'), sandbox);
  return { render: (v) => sandbox.window.PrMonitorCard.renderRun(v), box };
}

const READY = {
  seq: 7, ts: '2026-11-07T10:00:00.000Z', step_id: 'pr_monitor', url: 'https://github.com/acme/app/pull/42', number: 42, state: 'ready',
  checked_at: '2026-11-07T10:00:00.000Z', ci: { status: 'success', failed: [] }, review: { status: 'approved', by: ['bob'] },
  conflicts: { status: 'none' }, comments: { unanswered: 0 }, result: { ready: true, blockers: [] },
  merge_options: { merge: true, bypass: false, close: true, blockers: [], ignores: [] },
};
const BLOCKED = {
  ...READY, state: 'open', review: { status: 'required', by: [] }, result: { ready: false, blockers: ['approvals missing'] },
  merge_options: { merge: false, bypass: true, close: true, blockers: ['approvals_missing'], ignores: ['approvals_missing'] },
};
const actions = (html) => (html.match(/data-testid="(pr-merge|pr-merge-admin|pr-close)"/g) || []).map((s) => s.slice(13, -1));

test('#810 Run screen: a running run waiting in the monitor shows Merge and Close on its card', () => {
  const { render, box } = load();
  render({ run: { id: 'r1', status: 'running' }, prMonitor: READY });
  assert.deepEqual(actions(box.innerHTML), ['pr-merge', 'pr-close']);
});

for (const status of ['stopped', 'failed', 'done', 'paused']) {
  test(`#810 Run screen: a ${status} run shows its PR card with no Merge, bypass or Close button`, () => {
    const { render, box } = load();
    render({ run: { id: 'r1', status }, prMonitor: BLOCKED });
    assert.deepEqual([box.innerHTML.includes('data-testid="pr-monitor-card"'), actions(box.innerHTML), box.innerHTML.includes('data-pr-action')], [true, [], false]);
  });
}

test('#810 Run screen: the card redraws without its buttons when the run stops', () => {
  const { render, box } = load();
  render({ run: { id: 'r1', status: 'running' }, prMonitor: BLOCKED });
  const before = actions(box.innerHTML);
  render({ run: { id: 'r1', status: 'stopped' }, prMonitor: BLOCKED });
  assert.deepEqual([before, actions(box.innerHTML)], [['pr-merge-admin', 'pr-close'], []]);
});
