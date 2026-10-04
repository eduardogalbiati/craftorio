// Agent inboxes (#240): the closed lists of request kinds the Product Owner and the Supervisor accept.
//
// The interface these tests define (tests-first):
// - require('../src/product-owner').REQUEST_KINDS, sorted:
//     ['issue.file', 'issue.update', 'plan', 'queue.assign', 'roadmap.add', 'roadmap.move', 'roadmap.regroup', 'roadmap.skip']
//   ('plan' is the only judgment kind: it becomes a normal question to the PO's model; the rest are mechanical).
// - require('../src/supervisor-chat').REQUEST_KINDS, sorted:
//     ['dispatch.restart', 'run.resume', 'run.retry', 'run.stop', 'skill.restore', 'workflow.commit', 'workflow.restore']
//   (all mechanical: never a model call, US$ 0).
// - productOwner.handleRequest is an exported function; createSupervisorChat(...) returns an object
//   with a handleRequest function.
// - Service channels (see test/service/agent-inbox-240.test.js): po:request { projectId, kind, params,
//   reason, from, ref, mock } and supervisor:request { kind, params, reason, from, ref, mock }, both
//   resolving to { ok, text, costUsd, error? }.
// The modules are required inside each test: the exports do not exist yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('product-owner exports REQUEST_KINDS: the closed, sorted list of the PO\'s request kinds', () => {
  const { REQUEST_KINDS } = require('../src/product-owner');
  assert.deepEqual(REQUEST_KINDS, ['issue.file', 'issue.update', 'plan', 'queue.assign', 'roadmap.add', 'roadmap.move', 'roadmap.regroup', 'roadmap.skip']);
});

test('supervisor-chat exports REQUEST_KINDS: the closed, sorted list of the Supervisor\'s request kinds', () => {
  const { REQUEST_KINDS } = require('../src/supervisor-chat');
  assert.deepEqual(REQUEST_KINDS, ['dispatch.restart', 'run.resume', 'run.retry', 'run.stop', 'skill.restore', 'workflow.commit', 'workflow.restore']);
});

test('product-owner exports handleRequest as a function', () => {
  const productOwner = require('../src/product-owner');
  assert.equal(typeof productOwner.handleRequest, 'function');
});

test('createSupervisorChat(...) returns an object with a handleRequest function', (t) => {
  const { createSupervisorChat } = require('../src/supervisor-chat');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-kinds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const chat = createSupervisorChat({ dir: () => dir });
  assert.equal(typeof chat.handleRequest, 'function');
});
