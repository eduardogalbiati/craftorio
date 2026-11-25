// #49 on the workflows that scan a run's commits for secrets: feature, fix, release and the two AI Development
// heroes. Acceptance tests written before the code.
//
// Contract (the interface these tests assume; the step itself is in secret-scan.test.js):
// - One `type: secret_scan` step with no agent. Every route from the developer to the owner's
//   developer_check gate, the code review, a merge, a push or a pull request goes through it (release: every route to the Ship gate), so a turn with no new
//   commit, or the owner's Continue at another gate, does not go round it. The off switch is the step's
//   (it answers 'skipped'), not a route around it.
// - The input that turns it off has `secret` in its name and the label "Secret scan"; on by default.
// - Findings ('fail') go back to the developer twice (a count in `vars`, as rule_check: no supervisor), then to a
//   human gate; a pass starts the count again. From that gate nothing is merged, pushed or reviewed without
//   another scan, and Stop ends the run. An error of gitleaks goes to a gate, or ends the run as failed.
// - The developer's next prompt has the findings, the secret-triage skill and that the run's commits are
//   rewritten, never the base's; the code review's prompt has the entries the run added to .gitleaksignore.
// Seam: the loaded workflow, the engine's template evaluator, and the step's real output (helpers/fake-gitleaks.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { FILES, RULE, commit, defaults, installGitleaks, load, offInput, plainGit, planted, project, scan, scanStep } = require('./helpers/fake-gitleaks');
const { render, evalExpr } = require('../engine/run/templates');

plainGit();
const LIMIT = { timeout: 120000 };
const DEVELOPER = { release: 'fix' };
const developerOf = (name) => DEVELOPER[name] || 'develop';
// developer_check: the owner's gate says "secrets not scanned", so the scan comes first (features/secret-scan.feature)
const LANDS = ['ci', 'code_review', 'developer_check', 'pr_open', 'push_main', 'ship'];

// the transition the engine takes for this scope (first `when` that holds), with its `set` applied
function take(step, scope) {
  for (const tr of step.transitions || []) {
    let ok = false;
    try { ok = !tr.when || !!evalExpr(String(tr.when), scope); } catch { ok = false; }
    if (!ok) continue;
    const vars = { ...scope.vars };
    for (const [k, v] of Object.entries(tr.set || {})) vars[k] = typeof v === 'string' ? render(v, scope) : v;
    return { goto: tr.goto, status: tr.status || null, vars, transition: tr };
  }
  return { goto: null, status: null, vars: scope.vars, transition: null };
}

const FINDING = { rule: RULE, file: 'src/config-49.txt', line: 7, commit: 'abcdef1234567890abcdef1234567890abcdef12' };
const found = { kind: 'secret_scan', status: 'fail', findings: [FINDING], message: `1 secret found in the run's commits:\n- ${FINDING.rule} ${FINDING.file}:${FINDING.line} (commit ${FINDING.commit})`, round: 1 };
const passed = { kind: 'secret_scan', status: 'pass', findings: [], message: 'No secret found.', round: 1 };
const skipped = { kind: 'secret_scan', status: 'skipped', findings: [], message: 'Secrets not scanned: gitleaks is not installed.', round: 1 };

function setup(name) {
  const wf = load(name);
  const step = scanStep(wf, name);
  const developer = developerOf(name);
  const turn = { branch: 'feature-49', summary: 'done', files_changed: ['src/a.js'], committed: true, commit_sha: 'abc1234', issues: [], left_out: [], screenshots: [] };
  const scope = (output, vars = {}) => ({
    inputs: { ...defaults(wf), task: 'Add the widgets', repo_path: '/repos/widgets', base_branch: 'main' }, vars, output,
    worktree_dir: '', run_dir: '/runs/run-49', runs_dir: '/runs', run_id: 'run-49', previous_step: step.id, trail: [], agent: 'reviewer',
    steps: { [step.id]: { output, visits: 1 }, [developer]: { output: turn, outputs: [turn], visits: 2 }, version: { output: { version: '1.1.0' }, visits: 1 } },
  });
  return { wf, step, developer, scope, stepOf: (id) => wf.steps.find((s) => s.id === id) };
}

// the gate reached once the developer's two returns are used up
function findingGate(name) {
  const s = setup(name);
  let vars = {};
  const gotos = [];
  for (let i = 0; i < 3; i++) {
    const r = take(s.step, s.scope(found, vars));
    vars = r.vars;
    gotos.push(r.goto);
  }
  return { ...s, gotos, vars, gate: s.stepOf(gotos[2]) };
}

// every step id a step can lead to, whatever its conditions
const targets = (step) => [
  ...(step.transitions || []).flatMap((tr) => [tr.goto, tr.on_error, tr.on_exhausted, tr.loop?.on_exhausted]),
  step.on_error, step.on_exhausted, step.goal?.on_exhausted, step.loop?.on_exhausted,
].filter((id) => typeof id === 'string');
// what is reached from a step without the scan: the landing steps, and the steps that merge, push or ship
function landingsWithoutScan(wf, scanId, from) {
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const seen = new Set();
  const queue = [from];
  const landings = [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || id === scanId || !byId.has(id)) continue;
    seen.add(id);
    if (LANDS.includes(id)) { landings.push(id); continue; }
    if ((byId.get(id).transitions || []).some((tr) => tr.merge || tr.ship)) landings.push(`${id} (merge or ship)`);
    queue.push(...targets(byId.get(id)));
  }
  return landings;
}

const skillsOf = (wf, step) => [step.agent, step.delegate?.agent].filter(Boolean).flatMap((a) => wf.agents[a]?.skills || []).map(String);

for (const name of Object.keys(FILES)) {
  test(`#49 ${name}: one secret_scan step, with no agent`, () => {
    const { step } = setup(name);
    assert.equal(step.agent || step.agents || null, null);
  });

  test(`#49 ${name}: every route from the developer to the review, a merge or a push goes through the scan`, () => {
    const { wf, step, developer } = setup(name);
    assert.deepEqual(landingsWithoutScan(wf, step.id, developer), []);
    if (name === 'release') assert.deepEqual(landingsWithoutScan(wf, step.id, wf.steps[0].id), []);
  });

  test(`#49 ${name}: an input labelled "Secret scan" turns it off; it is on by default`, () => {
    const { def, off } = offInput(load(name), name);
    assert.equal(def.label, 'Secret scan');
    assert.notEqual(def.default, off);
    if (def.type !== 'boolean') assert.equal(def.enum.includes(off), true, 'no "off" value');
    else assert.equal(def.default, true);
  });

  test(`#49 ${name}: findings go back to the developer twice, then to a human gate`, () => {
    const { gotos, gate, developer } = findingGate(name);
    assert.deepEqual(gotos.slice(0, 2), [developer, developer]);
    assert.equal(gate?.type, 'human_approval', `the third goes to ${gotos[2]}`);
  });

  test(`#49 ${name}: a pass goes on and gives the developer its two returns again`, () => {
    const { step, scope, vars, developer, gotos } = findingGate(name);
    const pass = take(step, scope(passed, vars));
    assert.equal(!!pass.goto && ![developer, gotos[2], 'end', 'fail'].includes(pass.goto), true, `pass goes to ${pass.goto}`);
    assert.equal(take(step, scope(found, pass.vars)).goto, developer);
  });

  test(`#49 ${name}: a skipped scan goes on, as a pass does`, () => {
    const { step, scope } = setup(name);
    const on = take(step, scope(skipped)).goto;
    assert.equal(on !== null, true, 'a skipped scan takes no transition');
    assert.equal(on, take(step, scope(passed)).goto);
  });

  test(`#49 ${name}: the gate shows the findings, can stop the run, and lands nothing without another scan`, () => {
    const { wf, step, gate, scope, vars } = findingGate(name);
    assert.equal(!!gate, true, 'no gate');
    const s = scope(found, vars);
    const text = `${render(String(gate.summary || ''), s)}\n${render(String(gate.message || ''), s)}`;
    for (const part of [FINDING.file, String(FINDING.line), FINDING.rule]) assert.equal(text.includes(part), true, text);
    const stops = (gate.transitions || []).some((tr) => tr.goto === 'end' && ['failed', 'cancelled'].includes(tr.status));
    assert.equal(stops, true, 'no choice stops the run');
    assert.deepEqual(landingsWithoutScan(wf, step.id, gate.id), []);
  });

  test(`#49 ${name}: the developer sent back gets the findings, the skill, and to rewrite only the run's commits`, () => {
    const { wf, step, stepOf, developer, scope } = setup(name);
    const back = take(step, scope(found));
    assert.equal(back.goto, developer);
    const target = stepOf(developer);
    const prompt = render(String(back.transition.delegate?.prompt || target.prompt), scope(found, back.vars));
    for (const part of [FINDING.rule, FINDING.file, String(FINDING.line), FINDING.commit.slice(0, 7)]) assert.equal(prompt.includes(part), true, `no ${part} in the prompt`);
    assert.equal(prompt.includes('secret-triage') || skillsOf(wf, target).includes('secret-triage'), true, 'the developer has no secret-triage skill');
    const about = prompt.slice(Math.max(0, prompt.indexOf(FINDING.file) - 1500), prompt.indexOf(FINDING.file) + 1500);
    assert.match(about, /rewrit|rebase|amend|fixup/i);
    assert.match(about, /\bbase\b|`main`/i);
  });

  test(`#49 ${name}: an error of gitleaks goes to a human gate or ends the run as failed`, LIMIT, async (t) => {
    installGitleaks(t, { mode: 'partial' });
    const where = project(t);
    commit(where.dir, 'the change', { 'src/new.txt': 'clean\n' });
    const { step, out } = await scan(t, name, where);
    const { scope, stepOf, developer } = setup(name);
    const r = take(step, scope(out));
    assert.notEqual(r.goto, developer);
    assert.equal(stepOf(r.goto)?.type === 'human_approval' || (r.goto === 'end' && r.status === 'failed') || r.goto === 'fail', true, `goes to ${r.goto}`);
  });
}

// ---- the code review sees the new entries --------------------------------------------------------

for (const name of Object.keys(FILES).filter((n) => n !== 'release')) {
  test(`#49 ${name}: the code review's prompt has the entries the run added to .gitleaksignore, not the base's`, LIMIT, async (t) => {
    installGitleaks(t);
    const old = `${'0123456789'.repeat(4)}:old/base-49.txt:${RULE}:3`;
    const where = project(t, { '.gitleaksignore': `# an old one\n${old}\n` });
    const sha = commit(where.dir, 'the change', { 'test/new-49.txt': `${planted()}\n` });
    const entry = `${sha}:test/new-49.txt:${RULE}:1`;
    commit(where.dir, 'a made up token', { '.gitleaksignore': `# an old one\n${old}\n# a made up token of the tests\n${entry}\n` });
    const { wf, step, out, ctx } = await scan(t, name, where);
    assert.equal(out.status, 'pass', out.message);
    const { scope } = setup(name);
    const s = { ...scope(out), ...ctx, output: out, steps: scope(out).steps, previous_step: step.id, agent: 'reviewer' };
    const prompt = render(String(wf.steps.find((x) => x.id === 'code_review').prompt), s);
    assert.equal(prompt.includes(entry), true, 'the new entry is not in the prompt');
    assert.equal(prompt.includes(old), false, 'the base\'s entry is in the prompt');
  });
}

test('#49 fix: the code review\'s prompt says the run changed the project\'s gitleaks configuration', LIMIT, async (t) => {
  installGitleaks(t);
  const where = project(t);
  commit(where.dir, 'the change', { 'fixtures/a.txt': `${planted()}\n`, '.gitleaks.toml': "# made up tokens\n[allowlist]\npaths = ['''^fixtures/''']\n" });
  const { wf, out, ctx } = await scan(t, 'fix', where);
  const { scope } = setup('fix');
  const s = { ...scope(out), ...ctx, output: out, steps: scope(out).steps };
  const prompt = render(String(wf.steps.find((x) => x.id === 'code_review').prompt), s);
  assert.equal(prompt.includes('.gitleaks.toml'), true);
});
