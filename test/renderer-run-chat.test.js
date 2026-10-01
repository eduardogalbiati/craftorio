// src/renderer/views/runchat/runchat.js: it runs only inside the Electron renderer (document,
// window.Robots), so the pure `robot()` and `cardLines()` helpers are pulled out of the source and
// evaluated in a sandbox, the way test/renderer-run-summary.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { providerType } = require('../src/renderer/views/runchat/run-chat-model.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'runchat', 'runchat.js'), 'utf8');

function loadHelpers() {
  const isSupervisor = /const isSupervisor = [^\n]+/.exec(src)[0];
  const robot = /function robot\(who, st = 'idle', opts = \{\}\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const providersMap = /const PROVIDERS = \{[^\n]+\};/.exec(src)[0];
  const modesMap = /const MODES = \{[^\n]+\};/.exec(src)[0];
  const cardLines = /function cardLines\(who\) \{[\s\S]*?\n  \}/.exec(src)[0];
  for (const [name, code] of Object.entries({ isSupervisor, robot, providersMap, modesMap, cardLines })) {
    assert.ok(code, `${name} not found in runchat.js: the source moved`);
  }
  const sandbox = {
    providerType,
    chat: { model: { run: null } },
    window: { AgentLooks: null }, // the agent's saved look (Agents menu), when one exists (#68)
    Robots: {
      svg: (variant, st, opts) => ({ variant, st, ...opts }),
      variantFor: (type) => type,
      plaqueFor: (model) => model,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${isSupervisor}\n${robot}\n${providersMap}\n${modesMap}\n${cardLines}\n`
    + 'this.helpers = { robot, cardLines };',
    sandbox,
  );
  return { ...sandbox.helpers, sandbox };
}

const { robot, cardLines, sandbox } = loadHelpers();

test('robot(): an agent on the left is mirrored to face right, toward the centre of the screen', () => {
  assert.equal(robot({ agent: 'developer', side: 'left', provider: 'claude', model: 'claude-opus-5-5' }).mirror, true);
  // no side yet (a typing indicator before the first turn): stays on the left, mirrored
  assert.equal(robot({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' }).mirror, true);
});

test('robot(): an agent on the right is not mirrored, so it faces left, toward the centre', () => {
  assert.equal(robot({ agent: 'developer', side: 'right', provider: 'claude', model: 'claude-opus-5-5' }).mirror, false);
});

test('robot(): the supervisor is always mirrored, whatever side it is given', () => {
  assert.equal(robot({ agent: 'supervisor', side: 'right' }).mirror, true);
  assert.equal(robot({ agent: '_supervisor' }).mirror, true);
});

test('robot(): uses the workflow agent\'s saved look (Agents menu) over the provider\'s robot, when one exists', (t) => {
  t.after(() => { sandbox.chat.model.run = null; sandbox.window.AgentLooks = null; });
  sandbox.chat.model.run = { workflow: 'writer-reviewer.yaml' };
  sandbox.window.AgentLooks = { forWorkflow: (workflow, agent) => (workflow === 'writer-reviewer.yaml' && agent === 'writer' ? 'studio' : null) };
  assert.equal(robot({ agent: 'writer', provider: 'claude', model: 'claude-opus-5-5' }).variant, 'studio');
  // a different agent of the same workflow has no saved look: falls back to the provider's robot
  assert.equal(robot({ agent: 'reviewer', provider: 'codex', model: 'gpt-6-luna' }).variant, 'codex-cli');
});

test('robot(): without a saved look, draws the provider\'s robot as before', () => {
  assert.equal(robot({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' }).variant, 'claude-code');
});

test('cardLines(): the hover card shows provider, model and effort, then the session mode and turn', () => {
  // spread into a plain array: the sandbox's Array is a different realm than assert's
  const lines = [...cardLines({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', effort: 'high', mode: 'persistent', turn: 3 })];
  assert.deepEqual(lines, ['Claude · claude-opus-5-5 · effort high', 'persistent session · turn 3']);
});

test('cardLines(): missing effort, mode and turn are left out, not shown as blanks', () => {
  const lines = [...cardLines({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' })];
  assert.deepEqual(lines, ['Claude · claude-opus-5-5']);
});

test('cardLines(): a simulated session says so next to its provider', () => {
  const [first] = cardLines({ agent: 'developer', provider: 'mock', model: 'claude-opus-5-5' });
  assert.match(first, /\(simulated\)/);
});

test('turnHtml: a message on the right gets the rc-right class', () => {
  assert.match(src, /rc-\$\{it\.side === 'right' \? 'right' : 'left'\}/);
});

// #80: a run's chat always opens scrolled to its latest message, live or past (it used to open a
// past run at the start: "scroller.scrollTop = chat.live ? scroller.scrollHeight : 0").
test('openRun(): every run opens scrolled to its latest message, not only a live one', () => {
  const openRun = /async function openRun\(runId, \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(openRun, /toLatest\(\);/);
  assert.doesNotMatch(openRun, /scroller\.scrollTop = chat\.live \? scroller\.scrollHeight : 0/);
});

// #80: the Chat / Details toggle becomes the remembered run view for every later way of opening a run.
test('Details and "Chat" switch explicitly and become the remembered run view', () => {
  assert.match(src, /\$c\('#rc-details'\)\.onclick = \(\) => \{\s*setRunView\('details'\);/);
  assert.match(src, /setRunView\('chat'\);\s*openChatFor\(/);
});

// #80: "Jump to latest" appears once the reader has scrolled far enough up from the last message.
test('scrolledUp(): true once more than 240px of messages are below the visible area', () => {
  const scrolledUp = /const scrolledUp = \(s\) => [^\n]+;/.exec(src)[0];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${scrolledUp}\nthis.scrolledUp = scrolledUp;`, sandbox);
  assert.equal(sandbox.scrolledUp({ scrollHeight: 1000, scrollTop: 760, clientHeight: 200 }), false); // 40px below
  assert.equal(sandbox.scrolledUp({ scrollHeight: 1000, scrollTop: 500, clientHeight: 200 }), true); // 300px below
  assert.equal(sandbox.scrolledUp({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 }), false); // at the bottom
});
