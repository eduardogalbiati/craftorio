// #319 (acceptance tests, written before the code): the pure model of the first-run Setup.
//
// Contract (src/renderer/setup-model.js, new; browser global + module.exports, the pattern of
// src/renderer/default-workflow.js, so it is requirable from Node):
// - statusBadge(tool), tool = an envDetails entry { id, path, connected, auth, checking } ->
//   { label, state }: checking -> 'Checking…'/'checking'; path null -> 'Not installed'/'missing';
//   path set and not connected -> 'Not signed in'/'signed-out'; path set and connected -> 'Ready'/'ready'.
// - toolRequirement(id): 'Required' (claude, git), 'Optional: multi-model workflows' (codex, grok),
//   'Optional: Backlog sync and pull requests' (gh, glab).
// - requirementBadges(reqs), reqs = { clis, forge } -> labels, e.g. 'Needs Codex',
//   'Needs GitHub or GitLab CLI' when forge.
// - preselectedWorkflows(workflows, states), workflows = [{ id, requirements: { clis, forge } }]:
//   the ids with no missing requirement, 'ai-development-local-hero' first when ready, the others
//   in input order.
// - visibleWorkflows(workflows, hiddenWorkflows): the workflows whose id is not hidden, order
//   kept; a missing hidden list -> all.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../src/shared/setup-model');

test('statusBadge: checking, not installed, not signed in, ready', () => {
  const { statusBadge } = load();
  const pick = (t) => { const b = statusBadge(t); return `${b.label}|${b.state}`; };
  assert.equal(pick({ id: 'claude', path: null, connected: false, checking: true }), 'Checking…|checking');
  assert.equal(pick({ id: 'claude', path: null, connected: false }), 'Not installed|missing');
  assert.equal(pick({ id: 'codex', path: 'C:/bin/codex.cmd', connected: false }), 'Not signed in|signed-out');
  assert.equal(pick({ id: 'gh', path: '/usr/bin/gh', connected: true }), 'Ready|ready');
});

test('toolRequirement: Claude Code and Git are required, the others optional with their reason', () => {
  const { toolRequirement } = load();
  assert.equal(toolRequirement('claude'), 'Required');
  assert.equal(toolRequirement('git'), 'Required');
  assert.equal(toolRequirement('codex'), 'Optional: multi-model workflows');
  assert.equal(toolRequirement('grok'), 'Optional: multi-model workflows');
  assert.equal(toolRequirement('gh'), 'Optional: Backlog sync and pull requests');
  assert.equal(toolRequirement('glab'), 'Optional: Backlog sync and pull requests');
});

test('requirementBadges: Needs Codex for a workflow with Codex, Needs GitHub or GitLab CLI for forge', () => {
  const { requirementBadges } = load();
  assert.ok(requirementBadges({ clis: ['claude', 'codex', 'git'], forge: false }).includes('Needs Codex'));
  assert.ok(requirementBadges({ clis: ['claude', 'git'], forge: true }).includes('Needs GitHub or GitLab CLI'));
  assert.equal(requirementBadges({ clis: ['claude', 'git'], forge: false }).includes('Needs Codex'), false);
});

const WORKFLOWS = [
  { id: 'ai-arena', requirements: { clis: ['claude', 'codex', 'git'], forge: false } },
  { id: 'writer-reviewer', requirements: { clis: ['claude', 'git'], forge: false } },
  { id: 'ai-development-local-hero', requirements: { clis: ['claude', 'git'], forge: false } },
  { id: 'issue-tracker', requirements: { clis: ['claude', 'git'], forge: true } },
];

test('preselectedWorkflows: the ready workflows, ai-development-local-hero first, the others in input order', () => {
  const { preselectedWorkflows } = load();
  const states = { claude: 'ready', git: 'ready', codex: 'missing', grok: 'missing', gh: 'ready', glab: 'missing' };
  assert.deepEqual(preselectedWorkflows(WORKFLOWS, states), ['ai-development-local-hero', 'writer-reviewer', 'issue-tracker']);
});

test('preselectedWorkflows: a signed-out CLI or no forge leaves its workflows out', () => {
  const { preselectedWorkflows } = load();
  const states = { claude: 'signed-out', git: 'ready', codex: 'ready', gh: 'missing', glab: 'missing' };
  assert.deepEqual(preselectedWorkflows(WORKFLOWS, states), []);
  const noForge = { claude: 'ready', git: 'ready', codex: 'ready', gh: 'missing', glab: 'signed-out' };
  assert.deepEqual(preselectedWorkflows(WORKFLOWS, noForge), ['ai-development-local-hero', 'ai-arena', 'writer-reviewer']);
});

test('visibleWorkflows: hidden ids are left out, order kept; no hidden list shows all', () => {
  const { visibleWorkflows } = load();
  assert.deepEqual(visibleWorkflows(WORKFLOWS, ['ai-arena', 'issue-tracker']).map((w) => w.id), ['writer-reviewer', 'ai-development-local-hero']);
  assert.deepEqual(visibleWorkflows(WORKFLOWS, []).map((w) => w.id), WORKFLOWS.map((w) => w.id));
  assert.deepEqual(visibleWorkflows(WORKFLOWS, undefined).map((w) => w.id), WORKFLOWS.map((w) => w.id));
});
