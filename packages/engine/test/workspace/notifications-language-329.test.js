// #329 acceptance tests (written before the code): the OS notifications (packages/engine/domains/workspace/notifications.js) are
// written in the interface language (packages/shared/i18n.js setLanguage, set by the main process); the
// API is unchanged, and the user's content they quote (a run's title, a CLI's message) is not
// translated. English stays what it is today.
const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');

const i18n = () => require('@craftorio/shared/i18n.js');
const load = () => require('../../domains/workspace/notifications');

afterEach(() => {
  try { i18n().setLanguage('en'); } catch { /* the module does not exist yet */ }
});

test('#329 a session notice in pt-BR: Portuguese title and default body, the session\'s title kept', () => {
  i18n().setLanguage('pt-BR');
  const n = load().sessionNotice('t1', { title: 'My CLI' }, '');
  assert.ok(n.title.includes('My CLI'), n.title);
  assert.ok(!n.title.startsWith('Waiting for you:'), n.title);
  assert.notEqual(n.body, 'The CLI stopped and is waiting for your answer.');
  assert.equal(n.kind, 'session');
  assert.equal(n.event, 'waiting');
});

test('#329 a run notice in pt-BR is not English; back in English it is today\'s text', () => {
  const ev = { type: 'workflow.started', run_id: 'r1', workflow: 'writer-reviewer' };
  i18n().setLanguage('pt-BR');
  const pt = load().runNotice(ev, { workflow: 'writer-reviewer', project: null });
  assert.ok(pt.title.includes('writer-reviewer'), pt.title);
  assert.ok(!pt.title.startsWith('Run started:'), pt.title);
  i18n().setLanguage('en');
  const en = load().runNotice(ev, { workflow: 'writer-reviewer', project: null });
  assert.equal(en.title, 'Run started: writer-reviewer');
  assert.equal(en.body, 'Project: none');
});
