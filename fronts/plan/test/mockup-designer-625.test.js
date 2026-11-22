// #625 (D8): the mockup designer's chat turn, packages/engine/fronts/plan/domains/mockup-designer.js. One persistent
// session per screen (chat/<slug>.session.json): resumed while the model is the same and the session is not
// idle for 55 min, fresh otherwise (with the handoff note); each turn commits the ```html block, records its
// cost on the chat entry and in chat/usage.jsonl. runTurn is injected: no CLI is reached.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockups = require('@craftorio/engine/fronts/plan/domains/mockups');
const designer = require('@craftorio/engine/fronts/plan/domains/mockup-designer');

const GIT_VARS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

function workspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-ws-625-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'designer-cfg-625-'));
  const cfg = path.join(cfgDir, 'config');
  fs.writeFileSync(cfg, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');
  const saved = Object.fromEntries(GIT_VARS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const d of [ws, cfgDir]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return ws;
}

const payload = (message) => ({ message, selection: [{ mid: 'm3', selector: 'button', text: 'Export' }] });

function fakeRunTurn(calls) {
  return async (opts) => {
    calls.push(opts);
    return { text: `Done.\n\n\`\`\`html\n<main><h1>Orders ${calls.length}</h1></main>\n\`\`\``, costUsd: 0.05, usage: {}, providerSessionId: opts.providerSessionId || `s${calls.length}` };
  };
}

test('a turn resumes the session, commits the screen and adds up its cost', async (t) => {
  const ws = workspace(t);
  const { slug } = mockups.createScreen(ws, 'p1', { title: 'Orders', html: '<main><h1>Orders</h1></main>' });
  const calls = [];
  const runTurn = fakeRunTurn(calls);
  const first = await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('bigger'), now: 1000, runTurn });
  assert.equal(first.startReason, 'first');
  assert.equal(first.reply, 'Done.');
  assert.ok(first.commit);
  assert.equal(calls[0].providerSessionId, null);
  assert.equal(calls[0].cwd, mockups.projectDir(ws, 'p1'));

  const second = await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('red'), now: 2000, runTurn });
  assert.equal(second.startReason, null);
  assert.equal(calls[1].providerSessionId, 's1');
  assert.ok(!calls[1].prompt.includes('Handoff note'), 'a resumed turn sends only the message');
  assert.match(mockups.screenHtml(ws, 'p1', slug), /Orders 2/);
  assert.ok(Math.abs(second.totalUsd - 0.1) < 1e-9);
  const usage = fs.readFileSync(path.join(mockups.projectDir(ws, 'p1'), 'chat', 'usage.jsonl'), 'utf8').trim().split('\n');
  assert.equal(usage.length, 2);
});

test('after 55 idle minutes the turn starts a fresh session with the handoff note', async (t) => {
  const ws = workspace(t);
  const { slug } = mockups.createScreen(ws, 'p1', { title: 'Orders', html: '<main><h1>Orders</h1></main>' });
  const calls = [];
  const runTurn = fakeRunTurn(calls);
  await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('bigger'), now: 0, runTurn });
  const later = await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('red'), now: designer.FRESH_AFTER_IDLE_MS + 1, runTurn });
  assert.equal(later.startReason, 'idle');
  assert.equal(calls[1].providerSessionId, null);
  assert.match(calls[1].prompt, /Handoff note[\s\S]*Owner: bigger/);
});

test('a reply without an html block leaves the screen unchanged', async (t) => {
  const ws = workspace(t);
  const { slug } = mockups.createScreen(ws, 'p1', { title: 'Orders', html: '<main><h1>Orders</h1></main>' });
  const before = mockups.screenHtml(ws, 'p1', slug);
  const res = await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('why?'), runTurn: async () => ({ text: 'Because of the kit.', costUsd: 0.01 }) });
  assert.equal(res.commit, null);
  assert.equal(res.reply, 'Because of the kit.');
  assert.equal(mockups.screenHtml(ws, 'p1', slug), before);
});

test('the simulated turn makes one commit and costs nothing', async (t) => {
  const ws = workspace(t);
  const { slug } = mockups.createScreen(ws, 'p1', { title: 'Orders', html: '<main><h1>Orders</h1></main>' });
  const res = await designer.designerTurn({ workspace: ws, projectId: 'p1', slug, payload: payload('bigger'), simulated: true });
  assert.ok(res.commit);
  assert.equal(res.costUsd, 0);
  assert.match(res.reply, /Simulated designer/);
});
