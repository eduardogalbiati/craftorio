// #777: the E2E scenarios choose only workflows the app still offers. Since #630 and #648 the old
// bundled names (software-development, the local heroes, ...) are only aliases
// (packages/shared/default-workflow.js ALIASES): a saved run or roadmap item naming one still
// resolves, but the Start panel, the Product Owner's plan, the Workflows screen, the agent cards and
// the Settings default no longer offer it, so a step choosing it times out. This guard walks every
// .feature file and step / support file of the E2E scenarios and fails when a choosing step names a
// workflow that is neither a file of workflows/ nor a display title of one (aliases do not count).
// Seeded run data (past runs, roadmap items, "runs the workflow ...") is not a choosing step: it stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS_DIR = path.join(ROOT, 'workflows');
const SHARED_NAMES = path.join(ROOT, 'features', 'support', 'workflows.js');
const { ALIASES } = require('../default-workflow');

const label = (s) => String(s || '').replace(/^.*[\\/]/, '').replace(/\.ya?ml$/i, '');
const norm = (s) => label(s).trim().toLowerCase().replace(/[-_\s]+/g, ' ');

// The workflows the app offers: each file of workflows/ (its name with or without .yaml) and its
// display title (metadata.name, read in any case, hyphens as spaces: "test-backfill" / "Test backfill").
function offered() {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/i.test(f));
  const names = new Set();
  for (const file of files) {
    names.add(norm(file));
    const text = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
    const meta = text.match(/^metadata:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m);
    const name = meta && meta[1].match(/^[ \t]+name:\s*['"]?([^'"\n#]+?)['"]?\s*$/m);
    if (name) names.add(norm(name[1]));
    const title = meta && meta[1].match(/^[ \t]+title:\s*['"]?([^'"\n#]+?)['"]?\s*$/m);
    if (title) names.add(norm(title[1]));
  }
  return { files: new Set(files), names };
}

const RETIRED = new Set(Object.keys(ALIASES).map(norm));

function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
}

// every features/ folder of the repository: features/ and fronts/<front>/features/
function featureRoots() {
  const roots = [path.join(ROOT, 'features')];
  const fronts = path.join(ROOT, 'fronts');
  if (fs.existsSync(fronts)) {
    for (const f of fs.readdirSync(fronts)) roots.push(path.join(fronts, f, 'features'));
  }
  return roots.filter((r) => fs.existsSync(r));
}

const featureFiles = () => featureRoots().flatMap((r) => walk(r, (f) => f.endsWith('.feature')));
const stepFiles = () => featureRoots().flatMap((r) => walk(r, (f) => f.endsWith('.js')));

// The choosing steps: each pattern captures the workflow name(s) the step picks or expects offered.
const CHOOSING = [
  { step: 'I choose the workflow "<name>" in the Start panel', re: /I choose the workflow "([^"]+)" in the Start panel/ },
  { step: 'I plan with the workflow "<name>"', re: /I plan with the workflow "([^"]+)"/ },
  { step: 'the plan\'s workflow choice offers "<a>" and "<b>"', re: /the plan's workflow choice offers "([^"]+)" and "([^"]+)"/ },
  { step: 'I choose "<file>" as the default development workflow', re: /I choose "([^"]+)" as the default development workflow/ },
  { step: 'the default development workflow is "<file>"', re: /the default development workflow is "([^"]+)"/ },
  { step: 'the workflow agent "<key>" of "<file>"', re: /workflow agents? "[^"]+"(?: and "[^"]+")? of "([^"]+)"/ },
  { step: 'the workflow "<name>" is listed on the Workflows screen', re: /the workflow "([^"]+)" is listed on the Workflows screen/ },
  { step: 'I start a simulated run of the workflow "<file>"', re: /I start a simulated run of the workflow "([^"]+)"/ },
];

// Workflows a scenario creates itself (a repository's own workflow, an imported file) are offered too.
function declaredIn(text) {
  const own = new Set();
  for (const m of text.matchAll(/declares its own workflow "([^"]+)"/g)) own.add(norm(m[1]));
  for (const m of text.matchAll(/has a workflow "([^"]+)" that is not bundled/g)) own.add(norm(m[1]));
  return own;
}

function chosenInFeatures() {
  const out = [];
  for (const file of featureFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const own = declaredIn(text);
    text.split(/\r?\n/).forEach((line, n) => {
      if (/^\s*#/.test(line)) return;
      for (const { re } of CHOOSING) {
        const m = line.match(re);
        if (!m) continue;
        for (const name of m.slice(1)) {
          if (name !== undefined) out.push({ where: `${path.relative(ROOT, file)}:${n + 1}`, name, own, line: line.trim() });
        }
      }
    });
  }
  return out;
}

test('the choosing steps of the .feature files find something to check (the patterns still match the steps)', () => {
  const chosen = chosenInFeatures();
  assert.ok(chosen.length >= 5, `only ${chosen.length} choosing steps found`);
});

test('no .feature file chooses a retired workflow name (an alias) in a choosing step', () => {
  const offenders = chosenInFeatures()
    .filter((c) => RETIRED.has(norm(c.name)) || RETIRED.has(norm(`${c.name}.yaml`)))
    .map((c) => `${c.where}: "${c.name}" (${c.line})`);
  assert.deepEqual(offenders, [], `retired workflow names chosen:\n${offenders.join('\n')}`);
});

test('every workflow a .feature file chooses is a file of workflows/ or the display title of one', () => {
  const { names } = offered();
  const offenders = chosenInFeatures()
    .filter((c) => !names.has(norm(c.name)) && !c.own.has(norm(c.name)))
    .map((c) => `${c.where}: "${c.name}" (${c.line})`);
  assert.deepEqual(offenders, [], `workflows the app does not offer:\n${offenders.join('\n')}`);
});

test('a retired title such as "AI Development, local hero" or "Software development, local hero" is refused', () => {
  // the titles #630 / #648 retired are not a display title of any file of workflows/
  const { names } = offered();
  for (const title of ['AI Development, local hero', 'Software development, local hero', 'software-development', 'ai-development-local-hero.yaml']) {
    assert.equal(names.has(norm(title)), false, `"${title}" is still offered`);
  }
  assert.equal(names.has(norm('Feature')), true);
  assert.equal(names.has(norm('Test backfill')), true);
});

// A step or support file that selects a workflow with a literal (selectOption, the seeded
// lastWorkflow / defaultWorkflow setting) names an offered one, never an alias.
test('no step or support file selects or seeds a retired workflow name in a select or the settings', () => {
  const retiredLiteral = new RegExp(
    `['"\`](${Object.keys(ALIASES).map((k) => label(k).replace(/[-.]/g, '\\$&')).join('|')})(\\.yaml)?['"\`]`,
  );
  const offenders = [];
  for (const file of stepFiles()) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, n) => {
      if (/^\s*\/\//.test(line)) return;
      if (!/selectOption|lastWorkflow|defaultWorkflow/.test(line)) return;
      if (retiredLiteral.test(line)) offenders.push(`${path.relative(ROOT, file)}:${n + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `retired workflow names selected or seeded:\n${offenders.join('\n')}`);
});

// The shared names module: the workflow files and titles the scenarios choose, named once.
const loadShared = () => {
  assert.equal(fs.existsSync(SHARED_NAMES), true, 'features/support/workflows.js does not exist');
  return require(SHARED_NAMES);
};

function strings(value, out = [], seen = new Set()) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value)) strings(v, out, seen);
  }
  return out;
}

test('features/support/workflows.js names workflow files that exist in workflows/, none of them an alias', () => {
  const shared = loadShared();
  const { files } = offered();
  const yamls = strings(shared).filter((s) => /\.ya?ml$/i.test(s));
  assert.ok(yamls.length >= 1, 'the module names no workflow file');
  const missing = yamls.filter((f) => !files.has(label(f) + '.yaml') && !files.has(f));
  assert.deepEqual(missing, [], `workflow files not in workflows/: ${missing.join(', ')}`);
  const aliases = yamls.filter((f) => RETIRED.has(norm(f)));
  assert.deepEqual(aliases, []);
  assert.equal(yamls.includes('feature.yaml'), true, 'the module names feature.yaml');
});

test('features/support/workflows.js names the display title of a workflow it chooses ("Feature")', () => {
  const shared = loadShared();
  const { names } = offered();
  const titles = strings(shared).filter((s) => !/\.ya?ml$/i.test(s) && /[A-Z]/.test(s[0] || ''));
  assert.ok(titles.some((t) => norm(t) === 'feature'), `no "Feature" title among: ${titles.join(', ')}`);
  for (const t of titles.filter((s) => names.has(norm(s)))) assert.equal(RETIRED.has(norm(t)), false);
});

test('the seeded lastWorkflow of features/support/app.js comes from the shared names module', () => {
  const app = fs.readFileSync(path.join(ROOT, 'features', 'support', 'app.js'), 'utf8');
  assert.match(app, /require\(\s*['"]\.\/workflows(\.js)?['"]\s*\)/, 'app.js does not require ./workflows');
  const seed = app.split(/\r?\n/).find((l) => /lastWorkflow\s*:/.test(l)) || '';
  assert.ok(seed, 'app.js seeds no lastWorkflow');
  assert.doesNotMatch(seed, /lastWorkflow\s*:\s*['"`]/, `lastWorkflow is a literal: ${seed.trim()}`);
});

test("the test writer's E2E guide points at the shared names module to pick a workflow", () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skills', 'e2e-test-writer-js', 'SKILL.md'), 'utf8');
  assert.match(guide, /features\/support\/workflows\.js/);
});
