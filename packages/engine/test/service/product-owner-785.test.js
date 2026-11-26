// #785: po:ask lets the Product Owner decide (mode 'auto', the drawer has no toggle) and gives it the
// project's run defaults. Acceptance tests written before the code; productOwner.ask is stubbed at the
// channel's edge, no model is called.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const productOwner = require('../../domains/po/product-owner');
const { makeService, roadmapProject } = require('./helpers');

async function asked(t, name, params) {
  const { service, api } = makeService(t);
  const p = await roadmapProject(api, service.workspace(), t, [1], name);
  // #57: an empty folder is an undecided project (kind null): give it code, so its kind is decided
  fs.writeFileSync(path.join(p.folder, 'main.go'), 'package main\n');
  const real = productOwner.ask;
  t.after(() => { productOwner.ask = real; });
  const calls = [];
  productOwner.ask = async (opts) => { calls.push(opts); return { message: { role: 'po', text: 'ok', answer: { summary: 'ok', groups: [] } }, messages: [] }; };
  await api['po:ask']({ projectId: p.id, question: 'Analyze the backlog', mock: true, attachments: [], issues: [], ...params });
  return calls[0];
}

test('#785 po:ask passes mode auto through to the Product Owner', async (t) => {
  assert.equal((await asked(t, 'po-auto', { mode: 'auto' })).mode, 'auto');
});

test('#785 po:ask keeps an explicit register question in issue mode', async (t) => {
  assert.equal((await asked(t, 'po-issue', { mode: 'issue' })).mode, 'issue');
});

test('#785 po:ask gives the Product Owner the project\'s run defaults', async (t) => {
  const { runDefaults } = await asked(t, 'po-defaults', { mode: 'auto' });
  assert.deepEqual([typeof runDefaults?.kind, typeof runDefaults?.e2e_tests], ['string', 'string']);
});
