// User-defined agents (src/agents.js) and the built-in supervisor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const agents = require('../src/agents');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'agents');
}

const LOOK = { body: '#10b981', shell: '#FFFFFF', visor: '#000000', glow: '#FACC15', eyes: 'arcs', emblem: 'rocket' };

test('the supervisor and the Product Owner are always listed first, even with no agents folder', (t) => {
  const dir = tmp(t);
  const list = agents.listAgents(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'supervisor');
  assert.equal(list[0].system, true);
  assert.deepEqual(list[0].skills, ['run-supervisor']);
  assert.deepEqual(list[0].appearance, agents.DEFAULT_APPEARANCE);
  assert.equal(list[1].id, 'product-owner');
  assert.equal(list[1].system, true);
  assert.deepEqual(list[1].skills, ['backlog-product-owner']);
  assert.deepEqual(list[1].appearance, agents.PRODUCT_OWNER_APPEARANCE);
  assert.equal(list[1].model, 'claude-opus-5-5');
  assert.equal(list[1].effort, 'high');
});

test('create, edit and list agents; ids never collide with the supervisor', (t) => {
  const dir = tmp(t);
  const a = agents.createAgent(dir, { name: 'Security Reviewer', description: 'Finds holes', prompt: 'You review diffs.', skills: ['code-review', 'code-review', '../x'], appearance: LOOK });
  assert.equal(a.id, 'security-reviewer');
  assert.deepEqual(a.skills, ['code-review', 'x']);
  assert.equal(a.appearance.body, '#10B981');
  assert.equal(a.appearance.emblem, 'rocket');

  assert.equal(agents.createAgent(dir, { name: 'Supervisor', prompt: 'p' }).id, 'supervisor-2');
  assert.equal(agents.createAgent(dir, { name: 'Security reviewer', prompt: 'p' }).id, 'security-reviewer-2');
  assert.equal(agents.createAgent(dir, { name: '***', prompt: 'p' }).id, 'agent');

  const b = agents.saveAgent(dir, a.id, { name: 'Sec', prompt: 'New prompt', skills: [], appearance: { ...LOOK, eyes: 'slits' } });
  assert.equal(b.name, 'Sec');
  assert.equal(b.prompt, 'New prompt');
  assert.equal(b.createdAt, a.createdAt);
  assert.equal(b.appearance.eyes, 'slits');

  // the supervisor, then the Product Owner, then by name ("***", "Sec", "Security reviewer", "Supervisor")
  assert.deepEqual(agents.listAgents(dir).map((x) => x.id), ['supervisor', 'product-owner', 'agent', 'security-reviewer', 'security-reviewer-2', 'supervisor-2']);
});

test('name and prompt are required; a bad look falls back to the defaults', (t) => {
  const dir = tmp(t);
  assert.throws(() => agents.createAgent(dir, { name: ' ', prompt: 'p' }), /name/);
  assert.throws(() => agents.createAgent(dir, { name: 'A' }), /prompt/);
  const a = agents.createAgent(dir, { name: 'A', prompt: 'p', appearance: { body: 'red', eyes: 'lasers', emblem: 'spark', glow: '#12345' } });
  assert.deepEqual(a.appearance, agents.DEFAULT_APPEARANCE);
});

test('the supervisor keeps its prompt and skills: only its look is saved', (t) => {
  const dir = tmp(t);
  const s = agents.saveAgent(dir, 'supervisor', { name: 'Boss', prompt: 'Do anything', skills: ['x'], appearance: LOOK });
  assert.equal(s.name, 'Supervisor');
  assert.deepEqual(s.skills, ['run-supervisor']);
  assert.notEqual(s.prompt, 'Do anything');
  assert.equal(s.appearance.emblem, 'rocket');
  assert.equal(agents.listAgents(dir)[0].appearance.body, '#10B981');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'supervisor.json'), 'utf8'))).sort(), ['appearance', 'updatedAt']);
  assert.throws(() => agents.agentPathForRemoval(dir, 'supervisor'), /can't be removed/);
  assert.throws(() => agents.agentPathForRemoval(dir, '../supervisor'), /can't be removed/);
});

test('the Product Owner keeps its prompt and skills: only its look, model and effort are saved', (t) => {
  const dir = tmp(t);
  const s = agents.saveAgent(dir, 'product-owner', { name: 'PO', prompt: 'Do anything', skills: ['x'], model: 'claude-sonnet-5-5', effort: 'low', appearance: LOOK });
  assert.equal(s.name, 'Product Owner');
  assert.deepEqual(s.skills, ['backlog-product-owner']);
  assert.notEqual(s.prompt, 'Do anything');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.equal(s.effort, 'low');
  assert.equal(s.appearance.emblem, 'rocket');
  assert.throws(() => agents.saveAgent(dir, 'product-owner', { model: 'not a model!' }), /Not a model name/);
  assert.throws(() => agents.saveAgent(dir, 'product-owner', { effort: 'ultra' }), /Pick the effort/);
  assert.throws(() => agents.agentPathForRemoval(dir, 'product-owner'), /can't be removed/);
});

test('an empty or missing model/effort for the Product Owner falls back to its defaults', (t) => {
  const dir = tmp(t);
  const a = agents.saveAgent(dir, 'product-owner', { model: '', effort: '' });
  assert.equal(a.model, 'claude-opus-5-5');
  assert.equal(a.effort, 'high');
});

test('removal resolves only files inside the agents folder', (t) => {
  const dir = tmp(t);
  const a = agents.createAgent(dir, { name: 'Writer', prompt: 'p' });
  assert.equal(agents.agentPathForRemoval(dir, `../../${a.id}`), path.join(dir, 'writer.json'));
  assert.throws(() => agents.agentPathForRemoval(dir, 'nope'), /not found/);
});

test('a broken agent file is listed with its error instead of breaking the list', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
  const list = agents.listAgents(dir);
  assert.equal(list[2].id, 'broken');
  assert.ok(list[2].error);
});

test('the emblems and eyes match the ones the robots can draw', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'robots.js'), 'utf8');
  const block = (name) => src.slice(src.indexOf(`const ${name} = {`), src.indexOf('};', src.indexOf(`const ${name} = {`)));
  const keys = (name) => [...block(name).matchAll(/^\s{4}(\w+)[:(]/gm)].map((m) => m[1]);
  assert.deepEqual(keys('ICONS'), agents.EMBLEMS.filter((e) => e !== 'none'));
  assert.deepEqual(keys('EYES'), agents.EYES);
});
