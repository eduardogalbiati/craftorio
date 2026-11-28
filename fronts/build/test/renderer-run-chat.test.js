// fronts/build/views/runchat/runchat.js: it runs only inside the Electron renderer (document,
// window.Robots), so the pure `robot()` and `cardLines()` helpers are pulled out of the source and
// evaluated in a sandbox, the way test/renderer-run-summary.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { providerType } = require('../views/runchat/run-chat-model.js');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const src = fs.readFileSync(pageFileOf('views/runchat/runchat.js'), 'utf8');

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

// #227: the robot itself is painted in the agent's role colour (Robots.svg's `color`), not only its
// glow; a look saved in Agents still wins. The avatar helpers block (isSupervisor … robot) runs with
// the real AgentColors and the AI Development workflow's agents.
function loadColoredRobot(looks = {}) {
  const block = /const isSupervisor = [\s\S]*?\n  function robot\(who, st = 'idle', opts = \{\}\) \{[\s\S]*?\n  \}/.exec(src)?.[0];
  assert.ok(block, 'the avatar helpers (isSupervisor … robot) not found in runchat.js: the source moved');
  const AgentColors = require('@craftorio/ui-kit/agent-colors.js');
  const yaml = require('js-yaml');
  const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'), 'utf8'));
  const sandbox = {
    providerType,
    AgentColors,
    state: { workflows: [{ file: 'feature.yaml', name: wf.name, agents: wf.agents }] },
    chat: { model: { run: { workflow: 'feature.yaml' }, nameOf: (a) => a } },
    window: { AgentColors, AgentLooks: { forWorkflow: (workflow, agent) => looks[`${workflow}/${agent}`] || null } },
    Robots: {
      svg: (variant, st, opts) => ({ variant, st, ...opts }),
      variantFor: (type) => type,
      plaqueFor: (model) => model,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${block}\nthis.robot = robot;`, sandbox);
  return sandbox.robot;
}

test('robot(): a workflow agent\'s robot is painted in its role colour (test writer orange, developer blue)', () => {
  const robot = loadColoredRobot();
  assert.equal(String(robot({ agent: 'test_writer', provider: 'claude', model: 'claude-opus-5-5' }).color).toUpperCase(), '#FF8A3D');
  assert.equal(String(robot({ agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' }).color).toUpperCase(), '#4C7DFF');
});

test('robot(): a look saved for the agent in Agents wins over the role colour', () => {
  const robot = loadColoredRobot({ 'feature.yaml/test_writer': 'saved-look' });
  const r = robot({ agent: 'test_writer', provider: 'claude', model: 'claude-opus-5-5' });
  assert.equal(r.variant, 'saved-look');
  assert.equal(r.color, undefined);
});

test('robot(): the supervisor keeps its own robot, not painted in a role colour', () => {
  const robot = loadColoredRobot();
  const r = robot({ agent: 'supervisor' });
  assert.equal(r.variant, 'supervisor');
  assert.equal(r.color, undefined);
});

// #227: a role chip by the agent's name in a message's header (AgentColors.roleChip)
test('turnHtml: the message header shows the agent\'s role chip by its name', () => {
  const turnHtml = /function turnHtml\(it\) \{[\s\S]*?\n  \}/.exec(src)[0];
  const meta = /<div class="duo-meta">[^\n]*/.exec(turnHtml)?.[0] || '';
  assert.match(meta, /rc-name[\s\S]*roleChip\(/, 'the chip comes right after the name in the header');
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

// the redesign (2026-11-28, the owner's choice): every message on the left, whatever side the model gives it
test('turnHtml: every message sits on the left (rc-left), its robot facing the conversation', () => {
  assert.match(src, /class="rc-msg rc-left"/);
  assert.match(src, /agentAvatar\(\{ \.\.\.it, side: 'left' \}\)/);
  assert.doesNotMatch(src, /rc-\$\{it\.side === 'right' \? 'right' : 'left'\}/);
});

// turnHtml's activity block (#160): a sub-agent entry gets its own class, a tag for its type and
// its description (not the raw tool input); an ordinary tool keeps the plain rendering. Its summary
// comes from the catalog (#330: t() of packages/shared/i18n.js, in the language I18n is set to).
function activityExtras(activity) {
  const block = /const tools = it\.activity\.filter[\s\S]*?\n    \}\n/.exec(src)[0];
  assert.ok(block, 'activity block not found in runchat.js: the source moved');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sandbox = withI18n({ esc, it: { activity } });
  vm.createContext(sandbox);
  vm.runInContext(`const extras = [];\n${block}\nthis.extras = extras;`, sandbox);
  return sandbox.extras;
}

test('turnHtml activity: a sub-agent call renders its type and description, tagged rc-subagent', () => {
  const [html] = activityExtras([{ kind: 'tool', name: 'Task', input: '{}', subagent: { type: 'Explore', description: 'Map the login flow' } }]);
  assert.match(html, /<li class="rc-subagent">/);
  assert.match(html, /<span class="tag">Explore<\/span> Map the login flow/);
  assert.match(html, /1 sub-agent</);
});

test('turnHtml activity: an ordinary tool call (no subagent) keeps the plain rendering, with its input', () => {
  const [html] = activityExtras([{ kind: 'tool', name: 'Bash', input: '{"command":"npm test"}' }]);
  assert.doesNotMatch(html, /rc-subagent/);
  assert.match(html, /<b class="mono">Bash<\/b> <span class="mono muted">\{&quot;command&quot;:&quot;npm test&quot;\}<\/span>/);
  assert.doesNotMatch(html, /sub-agent/);
});

test('turnHtml activity: a failed sub-agent call still gets the err class alongside rc-subagent', () => {
  const [html] = activityExtras([{ kind: 'tool', name: 'Task', input: '{}', error: true, subagent: { type: 'Explore', description: 'Read the build log' } }]);
  assert.match(html, /<li class="rc-subagent err">/);
});

test('#330 turnHtml activity: the summary counts tool calls and sub-agents in the interface language', (t) => {
  const I18n = require('@craftorio/shared/i18n.js');
  t.after(() => I18n.setLanguage('en'));
  const calls = [
    { kind: 'tool', name: 'Task', input: '{}', subagent: { type: 'Explore', description: 'Map it' } },
    { kind: 'tool', name: 'Task', input: '{}', subagent: { type: 'Explore', description: 'Read it' } },
  ];
  assert.match(activityExtras(calls)[0], /<summary>2 tool calls · 2 sub-agents<\/summary>/);
  I18n.setLanguage('pt-BR');
  assert.match(activityExtras(calls)[0], /<summary>2 chamadas de ferramenta · 2 subagentes<\/summary>/);
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

// #181: the gate card spans the conversation's full width (runchat.css's .rc-gate), and its choice
// buttons sit side by side in one row, the first (primary) one first, not stacked.
test('gateHtml: the choice buttons sit in one .row.gate-choices row, the first one primary while open', () => {
  const gateHtml = /function gateHtml\(it\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(gateHtml, /<div class="row gate-choices">\$\{buttons\}<\/div>/, 'the buttons share one row, not one per line');
  assert.match(gateHtml, /class="btn sm \$\{!it\.resolved && i === 0 \? 'primary' : ''\}/, 'the first, unresolved choice is the primary one');
  assert.match(gateHtml, /c\.feedback_required \? ' data-needs-text="1"' : ''/, 'feedback_required still marks the choice as needing text');
  assert.match(gateHtml, /<div class="rc-gate" data-item="\$\{it\.id\}">/, 'the gate card keeps its rc-gate class (full width is runchat.css, not markup)');
});
