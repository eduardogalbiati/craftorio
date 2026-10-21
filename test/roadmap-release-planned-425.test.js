// #425 In Planned mode the Roadmap shows only the latest release. Acceptance tests written before the code.
//
// Interface: RoadmapModel.releaseView(r, data, wanted, showAll) (src/shared/roadmap-model.js) gains
// `showAll`: with no release chosen (`wanted` '') and showAll false (Planned), `shown` holds only the
// release with the greatest `at` among those with at >= 0; showAll true (All) keeps every placed
// release, as before. A chosen version and 'next' are unchanged. No releases: nothing shown.
// backlog-roadmap.js html() passes its view's showAll.
const test = require('node:test');
const assert = require('node:assert/strict');
const RoadmapModel = require('../src/shared/roadmap-model.js');
const H = require('./roadmap-status-helpers');

const done = (id, n, runId) => H.item(id, 'done', n, `Issue ${n}`, { runId, runs: [runId] });
// 4 stages; cut lines started: 1.0.0 after stage 2 (shipped), 1.1.0 after stage 3 (waiting at Ship),
// 1.2.0 after stage 4 (checking); 0.9.0 shipped, no stage in the roadmap (at -1)
function fixture() {
  return {
    roadmap: {
      state: 'paused',
      stages: [
        { id: 'st1', name: 'Login', note: '', items: [done('i1', 1, 'r1')] },
        { id: 'st2', name: 'Profile', note: '', release: { name: '1.0.0', status: 'shipped', runId: 'rel-100' }, items: [done('i2', 2, 'r2')] },
        { id: 'st3', name: 'Payments', note: '', release: { name: '1.1.0', runId: 'rel-110' }, items: [done('i3', 3, 'r3')] },
        { id: 'st4', name: 'Reports', note: '', release: { name: '1.2.0', runId: 'rel-120' }, items: [done('i4', 4, 'r4'), H.item('i5', 'planned', 5, 'Issue 5')] },
      ],
    },
    issues: [1, 2, 3, 4, 5].map((n) => ({ number: n, title: `Issue ${n}`, labels: [] })),
    releases: {
      releases: [
        { version: '0.9.0', status: 'shipped', runId: 'rel-090', tag: 'v0.9.0', date: '2026-09-20T12:00:00Z', commit: '0909090909090909090909090909090909090909', issues: [], runs: ['r0'], cost: 1 },
        { version: '1.0.0', status: 'shipped', runId: 'rel-100', tag: 'v1.0.0', date: '2026-10-05T12:00:00Z', commit: 'abc1234def567890abc1234def567890abc12345', issues: [{ number: 1 }, { number: 2 }], runs: ['r1', 'r2'], cost: 4.5 },
        { version: '1.1.0', status: 'waiting', runId: 'rel-110', runs: ['r3'] },
        { version: '1.2.0', status: 'checking', runId: 'rel-120', runs: ['r4'] },
      ],
    },
  };
}
const shownOf = (wanted, showAll, data = fixture()) => RoadmapModel.releaseView(data.roadmap, data, wanted, showAll).shown.map((x) => x.version);

// ---- releaseView ----------------------------------------------------------------------------------

test('#425 releaseView, Planned (no release chosen, showAll false): only the latest release (greatest at)', () => {
  assert.deepEqual(shownOf('', false), ['1.2.0']);
});

test('#425 releaseView, All (showAll true): every release placed on the roadmap, as before', () => {
  assert.deepEqual(shownOf('', true), ['1.0.0', '1.1.0', '1.2.0']);
});

test('#425 releaseView: a chosen release is shown alone, Planned or All', () => {
  assert.deepEqual([shownOf('1.0.0', false), shownOf('1.0.0', true)], [['1.0.0'], ['1.0.0']]);
});

test('#425 releaseView: "next" is unchanged in Planned (every release not shipped)', () => {
  assert.deepEqual(shownOf('next', false), ['1.1.0', '1.2.0']);
});

test('#425 releaseView: no releases, nothing shown', () => {
  const data = fixture();
  data.releases = { releases: [] };
  assert.deepEqual(shownOf('', false, data), []);
});

// ---- the Roadmap screen ------------------------------------------------------------------------------

const VERSIONS = ['0.9.0', '1.0.0', '1.1.0', '1.2.0'];
const versionsIn = (html, id) => H.findAll(html, (e) => e.attrs['data-testid'] === id)
  .map((e) => VERSIONS.filter((v) => `${H.visibleText(e.inner)} ${e.attrs['aria-label'] || ''}`.includes(v)).join(','));
const render = (view) => H.loadRoadmap().R.html(fixture(), () => {}, { since: 'total', ...view });

test('#425 Roadmap, Planned: only the latest release\'s block and version line', () => {
  const html = render({ showAll: false });
  assert.deepEqual([versionsIn(html, 'roadmap-release-block'), versionsIn(html, 'roadmap-release-line')], [['1.2.0'], ['1.2.0']]);
});

test('#425 Roadmap, All: every release\'s block', () => {
  assert.deepEqual(versionsIn(render({ showAll: true }), 'roadmap-release-block'), ['1.0.0', '1.1.0', '1.2.0']);
});

test('#425 Roadmap, Planned with a release chosen in the Releases filter: only that release', () => {
  assert.deepEqual(versionsIn(render({ showAll: false, release: '1.1.0' }), 'roadmap-release-block'), ['1.1.0']);
});
