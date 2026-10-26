// #555: the Product Owner's report (packages/engine/domains/po/product-owner.js backlogReport) lists the
// roadmap with a release entry (`{ kind: 'release', id, name, status? }` between stages) as a line of its
// own, and the stages keep their numbers (a release is not a stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const productOwner = require('../../domains/po/product-owner');

// The section from "## Roadmap" to the next "## " heading (or the end).
function section(report) {
  const at = report.indexOf('## Roadmap');
  if (at < 0) return null;
  const next = report.indexOf('\n## ', at + 1);
  return next < 0 ? report.slice(at) : report.slice(at, next);
}

const item = (number, status) => ({ id: `it${number}`, number, issues: [{ number }], status });
const DATA = {
  projectId: 'demo',
  issues: [],
  roadmap: {
    stages: [
      { id: 's1', name: 'Login', items: [item(1, 'done')] },
      { kind: 'release', id: 'rel-1', name: 'v1.4', status: 'planned', items: [] },
      { id: 's2', name: 'Alerts', items: [item(2, 'planned')] },
    ],
  },
};

test('#555 backlogReport: a release entry is its own line and the stage after it keeps number 2', () => {
  const lines = section(productOwner.backlogReport({ data: DATA, workflows: [] })).split('\n').slice(1).filter(Boolean);
  assert.deepEqual(lines, ['- stage 1 Login: #1 done', '- release v1.4 (planned)', '- stage 2 Alerts: #2 planned']);
});
