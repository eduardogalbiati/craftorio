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

// A copy of the bundled workflows, so a test can add/break a file without touching workflows/.
function tmpWorkflows(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(__dirname, '..', 'workflows');
  for (const f of fs.readdirSync(src).filter((x) => /\.ya?ml$/i.test(x))) {
    fs.copyFileSync(path.join(src, f), path.join(dir, f));
  }
  return dir;
}

const LOOK = { body: '#10b981', shell: '#FFFFFF', visor: '#000000', glow: '#FACC15', eyes: 'arcs', emblem: 'rocket' };

test('the supervisor, the Product Owner and the Oracle are always listed first, even with no agents folder', (t) => {
  const dir = tmp(t);
  const list = agents.listAgents(dir);
  assert.equal(list.length, 3);
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
  assert.equal(list[2].id, 'oracle');
  assert.equal(list[2].system, true);
  assert.deepEqual(list[2].skills, ['oracle']);
  assert.deepEqual(list[2].appearance, agents.ORACLE_APPEARANCE);
  assert.equal(list[2].model, 'claude-opus-5-5');
  assert.equal(list[2].effort, 'high');
  // the Oracle's own look is not confused with the supervisor's or the Product Owner's
  assert.notDeepEqual(list[2].appearance, list[0].appearance);
  assert.notDeepEqual(list[2].appearance, list[1].appearance);
});

test('create, edit and list agents; ids never collide with the supervisor', (t) => {
  const dir = tmp(t);
  const a = agents.createAgent(dir, { name: 'Security Reviewer', description: 'Finds holes', prompt: 'You review diffs.', skills: ['code-review', 'code-review', '../x'], appearance: LOOK });
  assert.equal(a.id, 'security-reviewer');
  assert.deepEqual(a.skills, ['code-review', 'x']);
  assert.equal(a.appearance.body, '#10B981');
  assert.equal(a.appearance.emblem, 'rocket');

  assert.equal(agents.createAgent(dir, { name: 'Supervisor', prompt: 'p' }).id, 'supervisor-2');
  assert.equal(agents.createAgent(dir, { name: 'Oracle', prompt: 'p' }).id, 'oracle-2'); // "oracle" is reserved too
  assert.equal(agents.createAgent(dir, { name: 'Security reviewer', prompt: 'p' }).id, 'security-reviewer-2');
  assert.equal(agents.createAgent(dir, { name: '***', prompt: 'p' }).id, 'agent');

  const b = agents.saveAgent(dir, a.id, { name: 'Sec', prompt: 'New prompt', skills: [], appearance: { ...LOOK, eyes: 'slits' } });
  assert.equal(b.name, 'Sec');
  assert.equal(b.prompt, 'New prompt');
  assert.equal(b.createdAt, a.createdAt);
  assert.equal(b.appearance.eyes, 'slits');

  // the supervisor, then the Product Owner, then the Oracle, then by name ("***", "oracle-2", "Sec", "Security reviewer", "Supervisor")
  assert.deepEqual(agents.listAgents(dir).map((x) => x.id), ['supervisor', 'product-owner', 'oracle', 'agent', 'oracle-2', 'security-reviewer', 'security-reviewer-2', 'supervisor-2']);
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

// ---- #189: the Product Owner's Speed ↔ Quality calibration -----------------------------------------

test('the Product Owner\'s calibration defaults to 2 (Speed-leaning) with no saved file', (t) => {
  const dir = tmp(t);
  assert.equal(agents.readAgent(dir, 'product-owner').calibration, 2);
  assert.equal(agents.listAgents(dir)[1].calibration, 2);
});

test('saving a calibration of 5 persists it; a later save that omits it keeps 5', (t) => {
  const dir = tmp(t);
  const a = agents.saveAgent(dir, 'product-owner', { calibration: 5 });
  assert.equal(a.calibration, 5);
  assert.equal(agents.readAgent(dir, 'product-owner').calibration, 5);
  // a later save (e.g. only the model) with no calibration keeps the one already saved
  const b = agents.saveAgent(dir, 'product-owner', { model: 'claude-sonnet-5-5' });
  assert.equal(b.calibration, 5);
});

test('a calibration outside 1..5 is refused; the saved one is unchanged', (t) => {
  const dir = tmp(t);
  agents.saveAgent(dir, 'product-owner', { calibration: 4 });
  assert.throws(() => agents.saveAgent(dir, 'product-owner', { calibration: 9 }), /Pick a calibration from 1 \(Speed\) to 5 \(Quality\)\./);
  assert.throws(() => agents.saveAgent(dir, 'product-owner', { calibration: 0 }), /Pick a calibration from 1 \(Speed\) to 5 \(Quality\)\./);
  assert.equal(agents.readAgent(dir, 'product-owner').calibration, 4); // the refused save left it as it was
});

test('only the Product Owner carries a calibration: the Oracle and the supervisor have none', (t) => {
  const dir = tmp(t);
  agents.saveAgent(dir, 'oracle', { model: 'claude-sonnet-5-5' });
  agents.saveAgent(dir, 'supervisor', { appearance: LOOK });
  assert.equal('calibration' in agents.readAgent(dir, 'oracle'), false);
  assert.equal('calibration' in agents.readAgent(dir, 'supervisor'), false);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8')), 'calibration'), false);
});

// #122: the Oracle, built in the same way as the Product Owner.
test('the Oracle keeps its prompt and skills: only its look, model and effort are saved; it cannot be removed', (t) => {
  const dir = tmp(t);
  const s = agents.saveAgent(dir, 'oracle', { name: 'Not Oracle', prompt: 'Do anything', skills: ['x'], model: 'claude-sonnet-5-5', effort: 'low', appearance: LOOK });
  assert.equal(s.name, 'Oracle');
  assert.deepEqual(s.skills, ['oracle']);
  assert.notEqual(s.prompt, 'Do anything');
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.equal(s.effort, 'low');
  assert.equal(s.appearance.emblem, 'rocket');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8'))).sort(), ['appearance', 'effort', 'model', 'updatedAt']);
  assert.throws(() => agents.saveAgent(dir, 'oracle', { model: 'not a model!' }), /Not a model name/);
  assert.throws(() => agents.saveAgent(dir, 'oracle', { effort: 'ultra' }), /Pick the effort/);
  assert.throws(() => agents.agentPathForRemoval(dir, 'oracle'), /can't be removed/);
  assert.throws(() => agents.agentPathForRemoval(dir, '../oracle'), /can't be removed/);
});

test('an empty or missing model/effort for the Oracle falls back to its defaults (claude-opus-5-5, high)', (t) => {
  const dir = tmp(t);
  const a = agents.saveAgent(dir, 'oracle', { model: '', effort: '' });
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
  assert.equal(list[3].id, 'broken');
  assert.ok(list[3].error);
});

// ---- workflow agents (#68) ----------------------------------------------------------------

test('listAgents without a workflowsDir keeps the old behaviour: no workflow agents', (t) => {
  const dir = tmp(t);
  const list = agents.listAgents(dir);
  assert.deepEqual(list.map((x) => x.id), ['supervisor', 'product-owner', 'oracle']);
});

test('listAgents(dir, { workflowsDir }) lists every agent of every workflow after the supervisor, the Product Owner and the Oracle', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  const list = agents.listAgents(dir, { workflowsDir });
  assert.equal(list[0].id, 'supervisor');
  assert.equal(list[1].id, 'product-owner');
  assert.equal(list[2].id, 'oracle');

  const workflowIds = list.slice(3).map((x) => x.id);
  assert.deepEqual(workflowIds, [
    'workflow:ai-arena.yaml:contender_1',
    'workflow:ai-arena.yaml:contender_2',
    'workflow:ai-arena.yaml:contender_3',
    'workflow:ai-arena.yaml:contender_4',
    'workflow:ai-arena.yaml:contender_5',
    'workflow:ai-arena.yaml:synthesizer',
    'workflow:ai-arena.yaml:verifier',
    'workflow:backlog-refresh.yaml:refresher',
    'workflow:issue-tracker.yaml:code_analyzer',
    'workflow:issue-tracker.yaml:issue_writer',
    'workflow:issue-tracker.yaml:issue_filer',
    'workflow:multi-model-review.yaml:opus',
    'workflow:multi-model-review.yaml:sonnet',
    'workflow:multi-model-review.yaml:gpt',
    'workflow:multi-model-review.yaml:blaster',
    'workflow:multi-model-review.yaml:judge',
    'workflow:run-retrospective.yaml:retro',
    'workflow:software-development-local-hero.yaml:developer',
    'workflow:software-development-local-hero.yaml:reviewer',
    'workflow:software-development-local-hero.yaml:test_writer',
    'workflow:software-development-local-hero.yaml:builder',
    'workflow:software-development-local-hero.yaml:verifier',
    'workflow:software-development-local-hero.yaml:evidence',
    'workflow:software-development.yaml:developer',
    'workflow:software-development.yaml:reviewer',
    'workflow:software-development.yaml:test_writer',
    'workflow:software-development.yaml:builder',
    'workflow:software-development.yaml:verifier',
    'workflow:software-development.yaml:evidence',
    'workflow:software-development.yaml:ci_pusher',
    'workflow:software-development.yaml:pr_babysitter',
    'workflow:software-development.yaml:deployer',
    'workflow:writer-reviewer.yaml:writer',
    'workflow:writer-reviewer.yaml:reviewer',
    'workflow:writer-reviewer.yaml:signoff',
  ]);

  const testWriter = list.find((x) => x.id === 'workflow:software-development.yaml:test_writer');
  assert.equal(testWriter.key, 'test_writer');
  assert.equal(testWriter.name, 'Test writer');
  assert.deepEqual(testWriter.workflow, { file: 'software-development.yaml', name: 'software-development' });
  assert.equal(testWriter.readOnly, true);
  assert.equal(testWriter.session, 'persistent');
  assert.ok(testWriter.skills.includes('unit-test-writer'), 'the templated skill name resolves to its family');
  assert.ok(testWriter.steps.includes('test'), 'the step that runs it is listed');

  // the fan-out step of ai-arena (`agents: [contender_1, ...]`) lists each contender
  const contender1 = list.find((x) => x.id === 'workflow:ai-arena.yaml:contender_1');
  assert.ok(contender1.steps.includes('compete'));
});

test('template resolution: writer-reviewer\'s user-picked models show "picked at start", its fixed signoff does not', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  const list = agents.listAgents(dir, { workflowsDir });

  const writer = list.find((x) => x.id === 'workflow:writer-reviewer.yaml:writer');
  assert.equal(writer.provider, 'claude');
  assert.equal(writer.providerType, 'claude-code');
  assert.equal(writer.model, 'claude-opus-5-5');
  assert.equal(writer.effort, 'high');
  assert.deepEqual([...writer.pickedAtStart].sort(), ['effort', 'model', 'provider']);

  const signoff = list.find((x) => x.id === 'workflow:writer-reviewer.yaml:signoff');
  assert.equal(signoff.provider, 'claude');
  assert.equal(signoff.model, 'claude-opus-5-5');
  assert.equal(signoff.effort, 'high');
  assert.deepEqual(signoff.pickedAtStart, []);
});

test('a workflow file that fails to load shows one entry with its error; the other workflows still list', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  fs.writeFileSync(path.join(workflowsDir, 'broken.yaml'), 'steps: [');
  const list = agents.listAgents(dir, { workflowsDir });

  const broken = list.filter((x) => x.workflowError);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].id, 'workflow:broken.yaml');
  assert.ok(broken[0].error);

  // the other workflows still produced their agents
  assert.ok(list.some((x) => x.id === 'workflow:writer-reviewer.yaml:writer'));
  assert.ok(list.some((x) => x.id === 'workflow:ai-arena.yaml:synthesizer'));
});

test('saveAgent on a workflow agent only saves its look; the YAML name, prompt and model are kept', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  const id = agents.workflowAgentId('writer-reviewer.yaml', 'writer');

  const saved = agents.saveAgent(dir, id, { name: 'Renamed', prompt: 'Different prompt', skills: ['z'], model: 'other-model', appearance: LOOK }, { workflowsDir });
  assert.equal(saved.name, 'Writer');
  assert.notEqual(saved.prompt, 'Different prompt');
  assert.equal(saved.model, 'claude-opus-5-5');
  assert.equal(saved.appearance.emblem, 'rocket');

  const lookFile = path.join(dir, 'workflows', 'writer-reviewer.yaml', 'writer.json');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(lookFile, 'utf8'))).sort(), ['appearance', 'updatedAt']);

  // the look file never shows up as a user agent
  const list = agents.listAgents(dir, { workflowsDir });
  assert.equal(list.find((x) => x.id === 'writer'), undefined);
  assert.equal(list.find((x) => x.id === id).appearance.emblem, 'rocket');

  const cleared = agents.saveAgent(dir, id, { appearance: null }, { workflowsDir });
  assert.equal(cleared.appearance, null);
  assert.equal(fs.existsSync(lookFile), false);
});

test('saveAgent on an unknown workflow agent throws', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  assert.throws(() => agents.saveAgent(dir, 'workflow:nope.yaml:foo', { appearance: LOOK }, { workflowsDir }), /Workflow agent not found/);
});

test('agentPathForRemoval refuses a workflow agent: it belongs to its workflow', (t) => {
  const dir = tmp(t);
  const id = agents.workflowAgentId('writer-reviewer.yaml', 'writer');
  assert.throws(() => agents.agentPathForRemoval(dir, id), /belongs to its workflow/);
});

test('editing a workflow file on disk is reflected in the next listAgents', (t) => {
  const dir = tmp(t);
  const workflowsDir = tmpWorkflows(t);
  const before = agents.listAgents(dir, { workflowsDir }).find((x) => x.id === 'workflow:writer-reviewer.yaml:signoff');
  assert.equal(before.model, 'claude-opus-5-5');

  const file = path.join(workflowsDir, 'writer-reviewer.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('model: claude-opus-5-5\n    effort: high\n    session: ephemeral', 'model: claude-sonnet-5-5\n    effort: high\n    session: ephemeral'));

  const after = agents.listAgents(dir, { workflowsDir }).find((x) => x.id === 'workflow:writer-reviewer.yaml:signoff');
  assert.equal(after.model, 'claude-sonnet-5-5');
});

test('the emblems and eyes match the ones the robots can draw', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'robots.js'), 'utf8');
  const block = (name) => src.slice(src.indexOf(`const ${name} = {`), src.indexOf('};', src.indexOf(`const ${name} = {`)));
  const keys = (name) => [...block(name).matchAll(/^\s{4}(\w+)[:(]/gm)].map((m) => m[1]);
  assert.deepEqual(keys('ICONS'), agents.EMBLEMS.filter((e) => e !== 'none'));
  assert.deepEqual(keys('EYES'), agents.EYES);
});
