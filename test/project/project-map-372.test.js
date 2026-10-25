// #372: the Project map workflow (workflows/project-map.yaml): an agent writes the project's city
// plan (#371's format), validated by rules. Checked here without a whole run: the definition, the
// read-only cartographer, the skill, the pure functions of the refresh and the validation, the docs.
// Whole simulated runs are in test/slow/project-map-372.slow.test.js; the Architecture tab's
// channels in test/service/architecture-map-372.test.js.
// Everything the change creates is loaded inside each test (tests first).
//
// Contract assumed by these tests (the developer implements it):
// - workflows/project-map.yaml, metadata.name `project-map`, steps in this order (others may sit
//   between them, e.g. a failure gate):
//     `facts`    (no agent): writes the cartographer's inputs to the run folder;
//     `plan`     (agent `cartographer`, skill `project-map`): answers the plan, nothing else;
//     `validate` (no agent): #371's validator on the plan; output `ok` (boolean). Not ok → back to
//                `plan` (with the report), at most 2 times (`max_visits: 2` or `loop.max_iterations: 2`),
//                then the run fails with the report. ok → `save` (#381: no gate by default), or
//                `gate` when the input `mode` is `validated`;
//     `gate`     (`type: human_approval`, validated mode): shows the plan's zones and districts
//                and the validation;
//     `save`     (no agent, not a gate): saves the plan as architecture:savePlan does;
//     `analyze`  (no agent, #381): the Oracle's architecture analysis after the plan is saved, unless
//                the boolean input `analyze` is off.
// - The cartographer is read-only on the project: its capabilities' tools are a subset of
//   [read, bash:git] (no edit, no write, no other command); the engine writes the plan file from its
//   answer (the plan step's output), so the only file the agent produces is the plan.
// - src/domains/project/project-map.js (new, Node):
//     treeCounts(files: string[]) → { folders, patterns }
//       folders: { <folder path, any depth>: files under it (recursive), '(root)': files at the root }
//       patterns: { <file-name pattern>: files }, each file counted once under its most specific
//         pattern: `*_<last word>.<ext>` when the name before its first dot has an underscore
//         (engine_tests.rs → *_tests.rs), else `*` + the name from its first dot (run.test.js →
//         *.test.js, README.md → *.md), else the name itself (Makefile).
//     manifestsOf(files: string[]) → string[]: the manifests at any depth (package.json, Cargo.toml,
//       go.mod, pyproject.toml, pom.xml, build.gradle(.kts), *.csproj), sorted.
// - packages/shared/city-model.js (#371's pure core) gains:
//     planVerdict(validation) → { ok: boolean, problems: string[] }: not ok on schema errors,
//       duplicate ids, unknown zones, or coverage under 0.95 (95% exactly passes); a problem about
//       coverage names "coverage".
//     refreshPlan(current, proposed) → plan: a refresh keeps every zone and district id of the
//       current plan and every name the owner saw (the current names win), takes the proposed rules
//       (include/exclude) for the districts both have, keeps the current districts the proposal
//       drops, and adds the proposal's new zones and districts.
//     planDiff(before, after) → { added: [district id], removed: [district id] }, sorted.
//     refreshSignal({ model, validation }) (a buildCity result) → { suggested: boolean,
//       unmatchedShare: number, newFolders: [top-level folder] }: suggested when more than 5% of the
//       drawn files match no rule, or when a top-level folder has drawn files and none of them
//       matches a rule (a new area); never for a folder city (no plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadWorkflow, evalExpr } = require('../../src/engine/workflow');
const caps = require('../../src/engine/capabilities');
const { buildModel } = require('@multiagent/shared/architecture-model');

const root = path.join(__dirname, '..', '..');
const WORKFLOW = path.join(root, 'workflows', 'project-map.yaml');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const loadWf = () => loadWorkflow(WORKFLOW);
const cityModel = () => require('@multiagent/shared/city-model');
const projectMap = () => require('../../src/domains/project/project-map');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const stepOf = (wf, id) => {
  const step = wf.steps.find((s) => s.id === id);
  assert.ok(step, `step "${id}" in workflows/project-map.yaml`);
  return step;
};
const scope = (output) => ({ output, steps: {}, inputs: {}, vars: {} });
const capOf = (tr) => (tr.max_visits ?? tr.loop?.max_iterations);

// ---------- the facts of a small repository (#356's model), for the pure functions ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20);
function facts(paths) {
  const date = '2026-01-05T12:00:00Z';
  return buildModel({
    head: { commit: hash(1), date }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: paths.map((p) => ({ path: p, lines: 10 })),
    log: `\x01${hash(1)} ${date}\n\n${paths.map((p) => `A\t${p}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  });
}

const FILES = [
  'docs/a.md', 'docs/b.md', 'docs/c.md',
  'src/engine/gates.js', 'src/engine/queue.js', 'src/engine/run.js',
  'src/ui/app.js', 'src/ui/board.js', 'src/ui/list.js',
  'test/gates.test.js', 'test/queue.test.js', 'test/run.test.js',
];

function plan(extra = {}) {
  return {
    version: 1, project: 'fixture', summary: 'A fixture.', ignore: [],
    zones: [
      { id: 'core', name: 'Core', kind: 'industrial', purpose: 'Runs the work.' },
      { id: 'ui', name: 'UI', kind: 'commercial', purpose: 'Screens.' },
      { id: 'campus', name: 'Campus', kind: 'campus', purpose: 'Tests.' },
      { id: 'books', name: 'Books', kind: 'library', purpose: 'Docs.' },
    ],
    districts: [
      { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
      { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/src/ui/**'], exclude: [] },
      { id: 'tests', name: 'Tests', zone: 'campus', purpose: 'x', include: ['/test/**'], exclude: [] },
      { id: 'docs', name: 'Docs', zone: 'books', purpose: 'x', include: ['/docs/**'], exclude: [] },
    ],
    landmarks: [], ports: [], evidence: [],
    ...extra,
  };
}

const cityOf = (p, files = FILES) => cityModel().buildCity({ plan: p, facts: facts(files) });

// ---------- the workflow definition ----------

test('#372 project-map workflow: the bundled workflow loads and is named project-map', () => {
  const wf = loadWf();
  assert.equal(wf.metadata.name, 'project-map');
});

test('#372 project-map workflow: steps facts → plan → validate → gate → save → analyze, facts first', () => {
  const wf = loadWf();
  const ids = wf.steps.map((s) => s.id);
  assert.equal(ids[0], 'facts');
  const order = ['facts', 'plan', 'validate', 'gate', 'save', 'analyze'].map((id) => ids.indexOf(id));
  assert.equal(order.includes(-1), false, `every step present in ${ids.join(', ')}`);
  assert.equal(order.join(), [...order].sort((a, b) => a - b).join(), `in order: ${ids.join(', ')}`);
});

test('#372 project-map workflow: facts, validate, save and analyze are machine steps; plan is the cartographer\'s turn', () => {
  const wf = loadWf();
  for (const id of ['facts', 'validate', 'save', 'analyze']) {
    const s = stepOf(wf, id);
    assert.equal(s.agent ?? null, null, `${id} has no agent`);
    assert.equal(s.agents ?? null, null, `${id} has no agents`);
    assert.notEqual(s.type ?? 'agent', 'agent', `${id} has a machine type`);
    assert.notEqual(s.type, 'human_approval', `${id} is not a gate`);
  }
  assert.equal(stepOf(wf, 'plan').agent, 'cartographer');
});

test('#372 project-map workflow: a failed validation goes back to plan at most 2 times; a passing one is saved (#381: no gate by default)', () => {
  const v = stepOf(loadWf(), 'validate');
  const failing = v.transitions.find((tr) => evalExpr(tr.when, scope({ ok: false, problems: ['coverage 25%'] })));
  assert.ok(failing, 'a transition for a failed validation');
  assert.equal(failing.goto, 'plan');
  assert.equal(Number(capOf(failing)), 2, 'at most 2 rounds back to plan');
  assert.ok(failing.on_exhausted, 'a target once the rounds are used up');
  assert.notEqual(failing.on_exhausted, 'gate', 'an invalid plan never reaches the gate');
  const passing = v.transitions.find((tr) => evalExpr(tr.when, { ...scope({ ok: true, problems: [] }), inputs: { mode: 'auto' } }));
  assert.equal(passing.goto, 'save');
  const validated = v.transitions.find((tr) => evalExpr(tr.when, { ...scope({ ok: true, problems: [] }), inputs: { mode: 'validated' } }));
  assert.equal(validated.goto, 'gate', 'validated mode shows the plan first');
});

test('#381 project-map workflow: the mode input is auto by default, validated on demand; the analysis is on by default', () => {
  const wf = loadWf();
  assert.equal(wf.inputs.mode.default, 'auto');
  assert.deepEqual([...wf.inputs.mode.enum].sort(), ['auto', 'validated']);
  assert.equal(wf.inputs.analyze.type, 'boolean');
  assert.equal(wf.inputs.analyze.default, true);
});

test('#372 project-map workflow: the gate is a human gate showing the plan\'s zones and districts and the validation, in its summary too', () => {
  const gate = stepOf(loadWf(), 'gate');
  assert.equal(gate.type, 'human_approval');
  const text = JSON.stringify(gate);
  assert.match(text, /steps\.validate/, 'the validation');
  assert.match(text, /plan\.districts/, 'the districts');
  assert.match(text, /plan\.zones/, 'the zones');
  assert.match(String(gate.summary || ''), /coverage/, 'the summary says the coverage');
  assert.match(String(gate.summary || ''), /zones/, 'the summary names the zones');
});

test('#372 project-map workflow: a valid plan (validate) or the approved gate saves; nothing else leads to save', () => {
  const wf = loadWf();
  const into = wf.steps.filter((s) => JSON.stringify(s.transitions || []).includes('"goto":"save"')).map((s) => s.id).sort();
  assert.deepEqual(into, ['gate', 'validate'], `steps that go to save: ${into.join(', ')}`);
  const gate = stepOf(wf, 'gate');
  // a plain approve/reject gate, or the first of its choices
  const first = (gate.choices || [])[0]?.id ?? null;
  const approved = gate.transitions.find((tr) => evalExpr(tr.when, { ...scope({}), approved: true, rejected: false, choice: first }));
  assert.equal(approved.goto, 'save');
});

test('#381 project-map workflow: save goes to the Oracle\'s analysis (a project_map step, action analyze), or ends when the analysis is off', () => {
  const wf = loadWf();
  const save = stepOf(wf, 'save');
  const on = save.transitions.find((tr) => evalExpr(tr.when, { ...scope({}), inputs: { analyze: true } }));
  assert.equal(on.goto, 'analyze');
  const off = save.transitions.find((tr) => evalExpr(tr.when, { ...scope({}), inputs: { analyze: false } }));
  assert.equal(off.goto, 'end');
  const analyze = stepOf(wf, 'analyze');
  assert.equal(analyze.type, 'project_map');
  assert.equal(analyze.action, 'analyze');
  assert.equal(analyze.transitions[0].goto, 'end');
});

test('#372 project-map workflow: the cartographer is read-only on the project (read, at most git)', () => {
  const wf = loadWf();
  const agent = wf.agents.cartographer;
  assert.ok(agent, 'an agent named cartographer');
  const c = caps.normalize(agent.capabilities);
  assert.ok(c, 'the cartographer declares its capabilities');
  assert.ok(c.tools.includes('read'), 'it reads the project');
  const extra = c.tools.filter((tool) => !['read', 'bash:git'].includes(tool));
  assert.deepEqual(extra, [], 'no edit, no write, no other command');
  assert.equal(c.web, false);
  // a step may not widen them either
  assert.equal(stepOf(wf, 'plan').capabilities ?? null, null, 'the plan step keeps the agent\'s capabilities');
  // Claude Code: no edit tool offered and no acceptEdits, so a write is refused by the CLI
  const { args } = caps.providerArgs('claude-code', { caps: c });
  const offered = args[args.indexOf('--tools') + 1].split(',');
  for (const tool of ['Edit', 'Write', 'NotebookEdit']) assert.equal(offered.includes(tool), false, `no ${tool}`);
  assert.equal(args.includes('acceptEdits'), false, 'no acceptEdits');
});

test('#372 project-map workflow: the cartographer follows the project-map skill', () => {
  const wf = loadWf();
  const skillsOf = [...(wf.agents.cartographer.skills || []), ...(stepOf(wf, 'plan').skills || [])];
  assert.ok(skillsOf.includes('project-map'), skillsOf.join(', '));
});

test('#372 project-map workflow: the cartographer is listed on the Agents screen, read-only', (t) => {
  const agents = require('../../src/domains/agents/agents');
  const workflowsDir = tmp(t, 'workflows-372-');
  for (const f of fs.readdirSync(path.join(root, 'workflows')).filter((x) => /\.ya?ml$/i.test(x))) {
    fs.copyFileSync(path.join(root, 'workflows', f), path.join(workflowsDir, f));
  }
  const list = agents.listAgents(path.join(tmp(t, 'agents-372-'), 'agents'), { workflowsDir });
  const cartographer = list.find((x) => x.id === 'workflow:project-map.yaml:cartographer');
  assert.ok(cartographer, 'workflow:project-map.yaml:cartographer is listed');
  assert.equal(cartographer.workflow.name, 'project-map');
  assert.ok(cartographer.steps.includes('plan'));
  assert.equal(/\bedit\b|\bwrite\b/.test(cartographer.capabilities), false, cartographer.capabilities);
});

// ---------- the skill ----------

test('#372 skill project-map is bundled with a valid frontmatter, and is not a -<suffix> family', () => {
  const skills = require('../../src/domains/agents/skills');
  const ids = skills.listSkills(path.join(root, 'skills')).map((s) => s.id);
  assert.ok(ids.includes('project-map'), 'skills/project-map/SKILL.md');
  assert.deepEqual(ids.filter((id) => id.startsWith('project-map-')), [], 'one skill for every language');
  const text = read('skills', 'project-map', 'SKILL.md');
  assert.match(text, /^---\r?\nname: project-map\r?\n/);
  assert.match(text, /^summary: \S/m, 'a summary in the frontmatter');
});

test('#372 skill project-map is seeded into a new workspace', (t) => {
  const skills = require('../../src/domains/agents/skills');
  const dest = path.join(tmp(t, 'skills-372-'), 'skills');
  const seeded = skills.seedSkills(path.join(root, 'skills'), dest);
  assert.ok(seeded.includes('project-map'), 'seeded');
  assert.ok(fs.existsSync(path.join(dest, 'project-map', 'SKILL.md')));
});

test('#372 skill project-map: the final plan format and glob rules of #371, no longer a draft', () => {
  const text = read('skills', 'project-map', 'SKILL.md');
  assert.equal(/proof of concept|draft/i.test(text), false, 'not the POC wording');
  assert.match(text, /leading `\/`/, 'a leading / anchors to the root');
  assert.match(text, /first district whose rules match wins/i);
  assert.match(text, /95%/, 'the coverage rule');
  for (const kind of ['campus', 'civic', 'commercial', 'industrial', 'infrastructure', 'library', 'logistics', 'power', 'workshop']) {
    assert.ok(text.includes(`\`${kind}\``), `zone kind ${kind}`);
  }
  assert.match(text, /keep(s)? (the )?ids/i, 'a refresh keeps the ids');
  assert.match(text, /never edit/i, 'read-only on the project');
});

// ---------- the facts step's inputs (src/domains/project/project-map.js) ----------

test('#372 treeCounts counts the tree by folder (recursive, root files apart) and by file-name pattern', () => {
  const { treeCounts } = projectMap();
  const out = treeCounts([
    'README.md', 'package.json', 'Makefile',
    'src/engine/run.js', 'src/engine/run.test.js', 'src/ui/app.js',
    'crates/core/src/engine_tests.rs', 'crates/core/src/lib.rs', 'crates/core/Cargo.toml',
    'docs/a.md',
  ]);
  assert.deepEqual(out.folders, {
    '(root)': 3, crates: 3, 'crates/core': 3, 'crates/core/src': 2, docs: 1, src: 3, 'src/engine': 2, 'src/ui': 1,
  });
  assert.deepEqual(out.patterns, {
    '*.js': 2, '*.json': 1, '*.md': 2, '*.rs': 1, '*.test.js': 1, '*.toml': 1, '*_tests.rs': 1, Makefile: 1,
  });
});

test('#372 manifestsOf finds the manifests at any depth, sorted', () => {
  const { manifestsOf } = projectMap();
  const out = manifestsOf([
    'src/app.js', 'package.json', 'crates/a/Cargo.toml', 'Cargo.toml', 'svc/go.mod', 'py/pyproject.toml',
    'java/pom.xml', 'net/App.csproj', 'docs/package.md', 'README.md',
  ]);
  assert.deepEqual(out, ['Cargo.toml', 'crates/a/Cargo.toml', 'java/pom.xml', 'net/App.csproj', 'package.json', 'py/pyproject.toml', 'svc/go.mod']);
});

// ---------- the validation verdict (packages/shared/city-model.js) ----------

test('#372 planVerdict: a plan matching every drawn file passes', () => {
  const { planVerdict } = cityModel();
  const out = planVerdict(cityOf(plan()).validation);
  assert.equal(out.ok, true);
  assert.equal(out.problems.length, 0);
});

test('#372 planVerdict: coverage under 95% fails and names the coverage', () => {
  const { planVerdict } = cityModel();
  const onlyEngine = plan({ districts: [plan().districts[0]] }); // 3 of 12 files
  const out = planVerdict(cityOf(onlyEngine).validation);
  assert.equal(out.ok, false);
  assert.equal(out.problems.some((p) => /coverage/i.test(p)), true, out.problems.join(' | '));
});

test('#372 planVerdict: exactly 95% coverage passes (19 of 20 files)', () => {
  const { planVerdict } = cityModel();
  const files = [...Array.from({ length: 19 }, (_, i) => `src/engine/f${String(i).padStart(2, '0')}.js`), 'src/stray.js'];
  const p = plan({ districts: [plan().districts[0]], zones: [plan().zones[0]] });
  const { validation } = cityOf(p, files);
  assert.equal(validation.coverage, 0.95);
  assert.equal(planVerdict(validation).ok, true);
});

test('#372 planVerdict: a district in an unknown zone fails', () => {
  const { planVerdict } = cityModel();
  const p = plan();
  p.districts[1] = { ...p.districts[1], zone: 'nowhere' };
  assert.equal(planVerdict(cityOf(p).validation).ok, false);
});

test('#372 planVerdict: a schema error fails', () => {
  const { planVerdict } = cityModel();
  const p = plan();
  p.zones[0] = { ...p.zones[0], kind: 'castle' };
  assert.equal(planVerdict(cityOf(p).validation).ok, false);
});

test('#372 planVerdict: a duplicate district id fails', () => {
  const { planVerdict } = cityModel();
  const p = plan();
  p.districts.push({ ...p.districts[0], include: ['/nothing/**'] });
  assert.equal(planVerdict(cityOf(p).validation).ok, false);
});

// ---------- the refresh (packages/shared/city-model.js) ----------

const CURRENT = {
  version: 1, project: 'fixture', summary: 'Before.', ignore: [],
  zones: [
    { id: 'core', name: 'Core (owner)', kind: 'industrial', purpose: 'x' },
    { id: 'ui', name: 'Screens', kind: 'commercial', purpose: 'x' },
  ],
  districts: [
    { id: 'engine', name: 'Run machine (owner)', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
    { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/src/ui/**'], exclude: [] },
  ],
  landmarks: [], ports: [], evidence: [],
};

const PROPOSED = {
  version: 1, project: 'fixture', summary: 'After.', ignore: [],
  zones: [
    { id: 'core', name: 'Core logic', kind: 'industrial', purpose: 'x' },
    { id: 'campus', name: 'Campus', kind: 'campus', purpose: 'x' },
  ],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**', '/src/core/**'], exclude: ['*.tmp'] },
    { id: 'tests', name: 'Test suite', zone: 'campus', purpose: 'x', include: ['/test/**'], exclude: [] },
  ],
  landmarks: [], ports: [], evidence: [],
};

const idsOf = (xs) => xs.map((x) => x.id).sort().join(',');
const byId = (xs, id) => xs.find((x) => x.id === id);

test('#372 refreshPlan keeps every zone and district id of the current plan and adds the new ones', () => {
  const { refreshPlan } = cityModel();
  const out = refreshPlan(CURRENT, PROPOSED);
  assert.equal(idsOf(out.zones), 'campus,core,ui');
  assert.equal(idsOf(out.districts), 'engine,tests,views');
});

test('#372 refreshPlan keeps the names the owner saw, for zones and districts', () => {
  const { refreshPlan } = cityModel();
  const out = refreshPlan(CURRENT, PROPOSED);
  assert.equal(byId(out.districts, 'engine').name, 'Run machine (owner)');
  assert.equal(byId(out.zones, 'core').name, 'Core (owner)');
  assert.equal(byId(out.districts, 'tests').name, 'Test suite', 'a new district keeps its proposed name');
});

test('#372 refreshPlan takes the proposed rules of a kept district', () => {
  const { refreshPlan } = cityModel();
  const engine = byId(refreshPlan(CURRENT, PROPOSED).districts, 'engine');
  assert.equal(engine.include.join(' '), '/src/engine/** /src/core/**');
  assert.equal(engine.exclude.join(' '), '*.tmp');
  assert.equal(engine.zone, 'core');
});

test('#372 refreshPlan never drops a district the owner saw: the proposal\'s omission keeps it with its rules', () => {
  const { refreshPlan } = cityModel();
  const views = byId(refreshPlan(CURRENT, PROPOSED).districts, 'views');
  assert.ok(views, 'views kept');
  assert.equal(views.name, 'Views');
  assert.equal(views.include.join(' '), '/src/ui/**');
});

test('#372 refreshPlan gives a plan that passes the plan schema', () => {
  const { refreshPlan, CITY_PLAN_SCHEMA } = cityModel();
  const { validateSchema } = require('../../src/domains/workspace/json-schema');
  assert.equal(validateSchema(refreshPlan(CURRENT, PROPOSED), CITY_PLAN_SCHEMA, 'plan').length, 0);
});

test('#372 planDiff lists the districts added and removed', () => {
  const { planDiff } = cityModel();
  const grown = { ...CURRENT, districts: [...CURRENT.districts, PROPOSED.districts[1]] };
  const forward = planDiff(CURRENT, grown);
  assert.equal(forward.added.join(','), 'tests');
  assert.equal(forward.removed.join(','), '');
  const back = planDiff(grown, CURRENT);
  assert.equal(back.added.join(','), '');
  assert.equal(back.removed.join(','), 'tests');
});

test('#372 refreshPlan keeps the proposal\'s order and puts the districts and zones it drops at the end', () => {
  const { refreshPlan } = cityModel();
  const out = refreshPlan(CURRENT, PROPOSED);
  assert.equal(out.districts.map((d) => d.id).join(','), 'engine,tests,views');
  assert.equal(out.zones.map((z) => z.id).join(','), 'core,campus,ui');
});

test('#372 refreshPlan without a current plan (a first map) is the proposal itself', () => {
  const { refreshPlan } = cityModel();
  const out = refreshPlan(null, PROPOSED);
  assert.equal(out.districts.map((d) => `${d.id}:${d.name}`).join(','), 'engine:Engine,tests:Test suite');
});

// ---------- the loader on `type: project_map` steps ----------

function variant(t, from, to) {
  const text = read('workflows', 'project-map.yaml').replace(/\r\n/g, '\n');
  assert.ok(text.includes(from), `the bundled workflow contains ${JSON.stringify(from)}`);
  const file = path.join(tmp(t, 'pm-wf-'), 'project-map.yaml');
  fs.writeFileSync(file, text.replace(from, to));
  return file;
}

test('#372 the loader refuses a project_map step with an unknown action', (t) => {
  const file = variant(t, 'action: facts\n', 'action: guess\n');
  assert.throws(() => loadWorkflow(file), /action/);
});

test('#372 the loader refuses a project_map step without an action', (t) => {
  const file = variant(t, '    action: facts\n', '');
  assert.throws(() => loadWorkflow(file), /action/);
});

test('#372 the loader refuses a validate step whose from is not a known step', (t) => {
  const file = variant(t, 'action: validate\n    from: plan\n', 'action: validate\n    from: nowhere\n');
  assert.throws(() => loadWorkflow(file), /from/);
});

test('#372 the loader refuses a validate step without from', (t) => {
  const file = variant(t, 'action: validate\n    from: plan\n', 'action: validate\n');
  assert.throws(() => loadWorkflow(file), /from/);
});

// ---------- the facts step on a folder that is not a git repository ----------

test('#372 the facts step fails on a folder that is not a git repository', async (t) => {
  const { mapFacts } = projectMap();
  const folder = tmp(t, 'pm-notgit-');
  fs.writeFileSync(path.join(folder, 'a.js'), 'x\n');
  const archRoot = tmp(t, 'pm-arch-');
  await assert.rejects(mapFacts({ folder, archRoot, projectId: 'p1' }), /not a git repository/);
});

// ---------- the refresh signal of the Architecture tab (packages/shared/city-model.js) ----------

const SIGNAL_PLAN = {
  version: 1, project: 'fixture', summary: 'x', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
    { id: 'views', name: 'Views', zone: 'core', purpose: 'x', include: ['/src/ui/**'], exclude: [] },
  ],
  landmarks: [], ports: [], evidence: [],
};
const files = (folder, n) => Array.from({ length: n }, (_, i) => `${folder}/f${String(i).padStart(2, '0')}.js`);

test('#372 refreshSignal: no signal when every drawn file matches a rule', () => {
  const { refreshSignal } = cityModel();
  const out = refreshSignal(cityOf(SIGNAL_PLAN, [...files('src/engine', 10), ...files('src/ui', 10)]));
  assert.equal(out.suggested, false);
  assert.equal(out.unmatchedShare, 0);
  assert.equal(out.newFolders.length, 0);
});

test('#372 refreshSignal: exactly 5% unmatched is no signal, more than 5% is', () => {
  const { refreshSignal } = cityModel();
  const five = refreshSignal(cityOf(SIGNAL_PLAN, [...files('src/engine', 10), ...files('src/ui', 9), 'src/misc.js']));
  assert.ok(Math.abs(five.unmatchedShare - 0.05) < 1e-9, String(five.unmatchedShare));
  assert.equal(five.suggested, false, 'exactly 5%');
  const more = refreshSignal(cityOf(SIGNAL_PLAN, [...files('src/engine', 10), ...files('src/ui', 9), 'src/misc.js', 'src/extra.js']));
  assert.equal(more.suggested, true, '2 of 21 files');
  assert.equal(more.newFolders.length, 0, 'src is not a new folder');
});

test('#372 refreshSignal: a new top-level folder signals a refresh even under 5%', () => {
  const { refreshSignal } = cityModel();
  const out = refreshSignal(cityOf(SIGNAL_PLAN, [...files('src/engine', 20), ...files('src/ui', 19), 'tools/gen.js']));
  assert.ok(Math.abs(out.unmatchedShare - 0.025) < 1e-9, String(out.unmatchedShare));
  assert.equal(out.suggested, true);
  assert.equal(out.newFolders.join(','), 'tools');
});

test('#372 refreshSignal: a folder city (no plan yet) never signals a refresh', () => {
  const { refreshSignal } = cityModel();
  const out = refreshSignal(cityOf(null, [...files('src/engine', 3), 'tools/gen.js']));
  assert.equal(out.suggested, false);
});

// ---------- docs ----------

test('#372 documented: a workflow README fragment in docs/features and the README names project-map.yaml', () => {
  const fragment = path.join(root, 'docs', 'features', 'project-map.md');
  assert.ok(fs.existsSync(fragment), 'docs/features/project-map.md');
  const text = fs.readFileSync(fragment, 'utf8');
  assert.match(text, /<!-- section:workflows -->/);
  assert.match(text, /workflows\/project-map\.yaml/);
  assert.match(read('README.md'), /project-map\.yaml/);
});

// decisions.md already names #372 in #371's entry (the roadmap): the decision itself names the workflow
test('#372 the owner\'s decisions record the project map workflow (only on click, the cartographer read-only)', () => {
  const text = read('docs', 'agents', 'decisions.md');
  assert.equal(text.includes('#372'), true, 'decisions.md names #372');
  assert.match(text, /project-map/, 'decisions.md names the project-map workflow');
  assert.match(text, /cartographer/i, 'decisions.md names the cartographer');
});
