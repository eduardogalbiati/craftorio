// #487: composing a project's workflow set from its ways-of-working profile (packages/engine/domains/workflow/workflow-compose.js).
// Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   require('../../domains/workflow/workflow-compose') exports
//   - openQuestions(profile) -> [{ id, question, default }]; ids from validate (validate every round
//     or trust auto), budget (per issue), screenshots, review (review rigour), release (release
//     style), merge (local | pr). A profile field with a value is settled and not asked (release,
//     merge); a field the profile leaves null is asked. validate, budget, screenshots and review are
//     never settled by the profile.
//   - composeWorkflowSet({ profile, answers, facts }) -> { workflows: [{ name, path, yaml }],
//     manifest: { path: '.multiagent/project.yaml', yaml } }; each path is
//     `.multiagent/workflows/<name>.yaml`; pure (returns strings, writes nothing).
//   profile (the ways-of-working seed's model.profile): { team: 'solo'|'team', merge: 'local'|'pr',
//     release: 'milestone'|'per-merge'|'train'|'rc-stable'|null, testCommand, ci, languages: [] }.
//   answers: { <question id>: value } override the profile's fields (answers.merge over profile.merge).
//   facts (the Architecture facts): { languages: [], skills: [] } (the language skills).
//   The set: one workflow per manifest entry: category `intake`, the development workflow under the
//     profile's team (`solo` | `team`), and `release`; entries `{ name, file: workflows/<name>.yaml,
//     category }` (packages/engine/domains/project/project-manifest.js parseManifest reads them with no error).
//   The development workflow merges locally (`merge: local` on a transition) for merge=local, and
//     works through a pull request (waits on a `pr_*` probe, as software-development does, and has no
//     `merge: local`) for merge=pr. Each release style gives its own release workflow.
//   The project's test command and the facts' language skill reach the development workflow's
//     agents (a step prompt, an agent's system_prompt or its skills).
//   Every file loads with the engine's loadWorkflow (fragments/ resolved), opens in the Builder
//   (full: fromWorkflow without problems; else fixed: describeWorkflow) and loads again after the
//   Builder writes it back. Development workflows also load as accepted repository workflows
//   (loadRepositoryWorkflow), since they live under .multiagent/workflows/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/workflow/workflow-compose');
const engine = () => require('../../engine/run/load');
const manifestParser = () => require('../../domains/project/project-manifest');
const builder = () => require('../../domains/workflow/workflow-builder');

const TEST_COMMAND = 'npm run test:ci-487';
const SKILL = 'unit-test-writer-js';
const FACTS = { languages: ['javascript'], skills: [SKILL] };

const profileOf = (over = {}) => ({
  // #630: the ci axis is none | release | pr+release, and tests unit | unit+e2e
  team: 'solo', merge: 'local', release: 'milestone', testCommand: TEST_COMMAND, ci: 'release', tests: 'unit', languages: ['javascript'], ...over,
});

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-487-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

const compose = (profile, answers = {}) => load().composeWorkflowSet({ profile, answers, facts: FACTS });
const ids = (questions) => questions.map((q) => q.id).sort();

// the set's files written under a temp project folder: { <manifest category>: absolute file }
function writeSet(t, out) {
  const dir = tmp(t);
  for (const w of [...out.workflows, out.manifest]) {
    const file = path.join(dir, ...w.path.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, w.yaml);
  }
  const byCategory = {};
  for (const e of manifestParser().parseManifest(out.manifest.yaml).workflows) byCategory[e.category] = path.join(dir, '.multiagent', ...String(e.file).split('/'));
  return byCategory;
}
const devFile = (files) => files.solo || files.team;

// every object of a loaded workflow's steps (nested steps, transitions, wait, recover)
function* nodes(v) {
  if (Array.isArray(v)) for (const x of v) yield* nodes(x);
  else if (v && typeof v === 'object') { yield v; for (const x of Object.values(v)) yield* nodes(x); }
}
const mergesLocally = (wf) => [...nodes(wf.steps)].some((n) => n.merge === 'local');
const waitsOnPullRequest = (wf) => [...nodes(wf.steps)].some((n) => /^pr_/.test(String(n.probe || '')));
const agentText = (wf) => [
  ...[...nodes(wf.steps)].map((n) => (typeof n.prompt === 'string' ? n.prompt : '')),
  ...Object.values(wf.agents || {}).map((a) => `${a?.system_prompt || ''} ${(a?.skills || []).join(' ')}`),
  `${wf.defaults?.system_prompt || ''} ${(wf.defaults?.skills || []).join(' ')}`,
].join('\n');

// ---- openQuestions ---------------------------------------------------------------------------------

test('#487 openQuestions on a profile that settles release and merge asks only validate, budget, review and screenshots', () => {
  assert.deepEqual(ids(load().openQuestions(profileOf())), ['budget', 'review', 'screenshots', 'validate']);
});

test('#487 openQuestions asks the release style when the profile does not know it', () => {
  assert.equal(ids(load().openQuestions(profileOf({ release: null }))).includes('release'), true);
});

test('#487 openQuestions asks local or pull request when the profile does not know the merge', () => {
  // #630: the merge question is now the mode (local | remote)
  assert.equal(ids(load().openQuestions(profileOf({ merge: null }))).includes('mode'), true);
});

test('#487 every open question has a question text and a default', () => {
  const questions = load().openQuestions(profileOf({ release: null, merge: null }));
  assert.equal(questions.length, 6);
  for (const q of questions) {
    assert.equal(typeof q.question, 'string', q.id);
    assert.equal(q.question.trim().length > 0, true, q.id);
    assert.equal(q.default === undefined, false, `${q.id} has a default`);
  }
});

// ---- composeWorkflowSet ----------------------------------------------------------------------------

test('#487 composeWorkflowSet returns YAML strings under .multiagent/workflows/<name>.yaml and the manifest\'s path', () => {
  const out = compose(profileOf());
  assert.equal(out.manifest.path, '.multiagent/project.yaml');
  assert.equal(typeof out.manifest.yaml, 'string');
  assert.equal(out.workflows.length >= 3, true);
  for (const w of out.workflows) {
    assert.equal(w.path, `.multiagent/workflows/${w.name}.yaml`);
    assert.equal(typeof w.yaml, 'string');
  }
});

test('#487 the manifest parses without errors and lists every composed file with an intake, a solo and a release entry', () => {
  const out = compose(profileOf());
  const parsed = manifestParser().parseManifest(out.manifest.yaml);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.workflows.map((e) => e.category).sort(), ['intake', 'release', 'solo']);
  assert.deepEqual(parsed.workflows.map((e) => `.multiagent/${e.file}`).sort(), out.workflows.map((w) => w.path).sort());
});

test('#487 a team profile files its development workflow under the team category', () => {
  const parsed = manifestParser().parseManifest(compose(profileOf({ team: 'team', merge: 'pr' })).manifest.yaml);
  assert.deepEqual(parsed.workflows.map((e) => e.category).sort(), ['intake', 'release', 'team']);
});

test('#487 merge=local composes a development workflow that merges locally and opens no pull request', (t) => {
  const wf = engine().loadWorkflow(devFile(writeSet(t, compose(profileOf({ merge: 'local' })))));
  assert.equal(mergesLocally(wf), true);
  assert.equal(waitsOnPullRequest(wf), false);
});

test('#487 the merge answer overrides the profile: answers.merge=pr composes a pull-request development workflow', (t) => {
  const wf = engine().loadWorkflow(devFile(writeSet(t, compose(profileOf({ merge: 'local' }), { merge: 'pr' }))));
  assert.equal(waitsOnPullRequest(wf), true);
  assert.equal(mergesLocally(wf), false);
});

test('#487 each release style composes its own release workflow', () => {
  const styles = ['milestone', 'per-merge', 'train', 'rc-stable'];
  const texts = styles.map((release) => {
    const out = compose(profileOf({ release }));
    const entry = manifestParser().parseManifest(out.manifest.yaml).workflows.find((e) => e.category === 'release');
    return out.workflows.find((w) => w.path === `.multiagent/${entry.file}`).yaml;
  });
  assert.equal(new Set(texts).size, 4);
});

test('#487 the development workflow\'s agents get the project\'s test command and the language skill', (t) => {
  const text = agentText(engine().loadWorkflow(devFile(writeSet(t, compose(profileOf())))));
  assert.equal(text.includes(TEST_COMMAND), true, 'the test command reaches a prompt');
  assert.equal(text.includes(SKILL), true, 'the language skill reaches an agent');
});

// ---- the composed files load in the engine ---------------------------------------------------------

const TABLE = [
  { team: 'solo', merge: 'local', release: 'milestone' },
  { team: 'solo', merge: 'local', release: 'per-merge' },
  { team: 'team', merge: 'pr', release: 'train' },
  { team: 'team', merge: 'pr', release: 'rc-stable' },
];

for (const row of TABLE) {
  test(`#487 ${row.team} / ${row.merge} / ${row.release}: every composed workflow loads with loadWorkflow and has steps`, (t) => {
    const out = compose(profileOf(row));
    const files = writeSet(t, out);
    assert.equal(Object.keys(files).length, 3);
    for (const w of out.workflows) {
      const file = path.join(path.dirname(files.release), `${w.name}.yaml`);
      let wf = null;
      assert.doesNotThrow(() => { wf = engine().loadWorkflow(file); }, w.name);
      assert.equal(Array.isArray(wf.steps) && wf.steps.length > 0, true, `${w.name} has steps`);
    }
  });
}

test('#487 the development workflows load as accepted repository workflows', (t) => {
  for (const row of [TABLE[0], TABLE[2]]) {
    const file = devFile(writeSet(t, compose(profileOf(row))));
    assert.doesNotThrow(() => engine().loadRepositoryWorkflow(file, { accepted: true }), `${row.team}/${row.merge}`);
  }
});

test('#487 every composed workflow opens in the Builder (full or fixed) and loads again after the Builder writes it', (t) => {
  const b = builder();
  for (const row of [TABLE[0], TABLE[2]]) {
    const out = compose(profileOf(row));
    const files = writeSet(t, out);
    for (const w of out.workflows) {
      const file = path.join(path.dirname(files.release), `${w.name}.yaml`);
      const doc = engine().loadWorkflow(file);
      const drawn = b.fromWorkflow(doc);
      const full = drawn.problems.length === 0;
      const text = full ? b.toYaml(drawn.spec) : b.patchWorkflow(doc, b.describeWorkflow(doc), b.leadingComments(w.yaml));
      if (!full) assert.equal(b.describeWorkflow(doc).fixed, true, `${w.name} opens fixed`);
      const back = path.join(tmp(t), `${w.name}.yaml`);
      fs.writeFileSync(back, text);
      assert.equal(engine().loadWorkflow(back).steps.length, doc.steps.length, `${w.name} round-trips`);
    }
  }
});
