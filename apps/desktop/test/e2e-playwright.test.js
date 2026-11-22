// Acceptance tests for #222: the app's end-to-end suite runs on Playwright + playwright-bdd
// (features/*.feature, steps in features/steps/), deterministically, with role/test-id assertions
// and committed visual baselines. These checks read the repository (package.json, the Playwright
// config, the feature files, the renderer and the skills); only the last one opens the app, with
// MULTIAGENT_UI_TESTS=1.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = () => JSON.parse(read('package.json'));

// every file under a folder (relative to the root), optionally filtered by extension
const walk = (dir, exts) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(rel, exts);
    return !exts || exts.includes(path.extname(e.name)) ? [rel] : [];
  });
};

const configFile = () => ['playwright.config.js', 'playwright.config.cjs', 'playwright.config.mjs', 'playwright.config.ts']
  .find((f) => fs.existsSync(path.join(root, f)));
const loadConfig = async () => {
  const file = configFile();
  assert.ok(file, 'a playwright.config.{js,cjs,mjs,ts} at the repository root');
  const mod = await import(pathToFileURL(path.join(root, file)).href);
  return mod.default && typeof mod.default === 'object' ? mod.default : mod;
};

// Minimal Gherkin reader: each scenario with its effective tags (feature + scenario) and step lines.
const parseFeature = (text, file) => {
  const scenarios = [];
  let pending = [];
  let featureTags = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) { pending.push(...line.split(/\s+/).filter((t) => t.startsWith('@'))); continue; }
    if (/^Feature:/.test(line)) { featureTags = pending; pending = []; current = null; continue; }
    if (/^(Scenario|Scenario Outline|Example):/.test(line)) {
      current = { file, name: line.replace(/^[^:]+:\s*/, ''), tags: [...featureTags, ...pending], steps: [] };
      scenarios.push(current);
      pending = [];
      continue;
    }
    if (/^(Background|Rule|Examples):/.test(line)) { current = null; pending = []; continue; }
    if (current && /^(Given|When|Then|And|But|\*)\s/.test(line)) current.steps.push(line);
  }
  return scenarios;
};
const featureFiles = () => walk('features', ['.feature']);
const allScenarios = () => featureFiles().flatMap((f) => parseFeature(read(f), f));
const stepSources = () => walk(path.join('features', 'steps'), ['.js', '.cjs', '.mjs', '.ts']).map((f) => read(f)).join('\n');

test('package.json has @playwright/test and playwright-bdd as dev dependencies and a test:e2e script that runs them', () => {
  const p = pkg();
  assert.ok(p.devDependencies?.['@playwright/test'], 'devDependencies["@playwright/test"]');
  assert.ok(p.devDependencies?.['playwright-bdd'], 'devDependencies["playwright-bdd"]');
  assert.equal(p.dependencies?.['@playwright/test'], undefined, 'not a runtime dependency of the packaged app');
  // scripts/e2e.js runs bddgen, then playwright test (phase 3 of the reorganisation study: one front's features too)
  assert.match(p.scripts?.['test:e2e'] || '', /bddgen|playwright|scripts\/e2e\.js/, 'scripts["test:e2e"] runs playwright-bdd / playwright');
});

test('the Playwright config runs the visual lane one at a time, keeps traces, videos and screenshots of failures and writes JSON results', async () => {
  const config = await loadConfig();
  // #365: the behaviour lane runs in parallel; the @visual lane keeps one Electron at a time (the machine slot, #199)
  const visual = (config.projects || []).find((p) => p.name === 'visual');
  assert.equal(visual?.workers, 1, 'the visual lane runs one Electron at a time (the machine slot, #199)');
  const use = config.use || {};
  assert.match(String(use.trace), /retain-on-failure|on-first-retry|^on$/, 'a trace is kept for a failing scenario');
  assert.match(String(use.video?.mode ?? use.video), /retain-on-failure|on-first-retry|^on$/, 'a video is kept for a failing scenario');
  assert.match(String(use.screenshot?.mode ?? use.screenshot), /only-on-failure|^on$/, 'a screenshot is kept for a failing scenario');
  const reporters = (Array.isArray(config.reporter) ? config.reporter : [[config.reporter]]).map((r) => (Array.isArray(r) ? r[0] : r));
  assert.ok(reporters.includes('json'), `a json reporter (got ${JSON.stringify(reporters)})`);
  // playwright-bdd generates the specs from features/: the test folder is its output
  assert.ok(config.testDir, 'testDir set (defineBddConfig output)');
});

test('visual baselines compare with a pixel-ratio threshold, without an LLM', async () => {
  const config = await loadConfig();
  const ratio = config.expect?.toHaveScreenshot?.maxDiffPixelRatio;
  assert.equal(typeof ratio, 'number', 'expect.toHaveScreenshot.maxDiffPixelRatio is set');
  assert.ok(ratio > 0 && ratio <= 0.1, `a small threshold (got ${ratio})`);
  assert.match(stepSources(), /toHaveScreenshot\(/, 'a step compares a screen against its baseline');
});

test('the baselines are committed, for both themes', () => {
  const r = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', '*.png'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const pngs = r.stdout.split(/\r?\n/).filter(Boolean)
    .filter((f) => !/^(docs|src|test|build|dist|scripts)\//.test(f) && !f.startsWith('test-results/'));
  assert.ok(pngs.length >= 2, `baseline images outside docs/src/test (got ${pngs.length})`);
  assert.ok(pngs.some((f) => /light/i.test(f)), 'a light-theme baseline');
  assert.ok(pngs.some((f) => /dark/i.test(f)), 'a dark-theme baseline');
});

test('the app is launched with Playwright\'s _electron in simulation, on a scratch workspace, never as plain Node', () => {
  const file = configFile();
  const sources = [file ? read(file) : '', ...walk('features', ['.js', '.cjs', '.mjs', '.ts']).map((f) => read(f))].join('\n');
  assert.match(sources, /_electron/, '_electron from playwright / @playwright/test');
  assert.match(sources, /\.launch\(/, '_electron.launch(...)');
  assert.match(sources, /MULTIAGENT_SIMULATION_ONLY/, 'the app runs with MULTIAGENT_SIMULATION_ONLY=1');
  assert.match(sources, /MULTIAGENT_WORKSPACE/, 'a fresh scratch workspace');
  assert.match(sources, /ELECTRON_RUN_AS_NODE/, 'ELECTRON_RUN_AS_NODE is removed from the launched environment');
});

test('feature files live in features/, every scenario is tagged @issue-<n>', () => {
  const files = featureFiles();
  assert.ok(files.length >= 2, `one feature file per area (got ${files.length})`);
  const scenarios = allScenarios();
  assert.ok(scenarios.length > 0, 'scenarios in the feature files');
  const untagged = scenarios.filter((s) => !s.tags.some((t) => /^@issue-\d+$/.test(t)));
  assert.deepEqual(untagged.map((s) => `${s.file}: ${s.name}`), [], 'every scenario has an @issue-<n> tag');
  for (const s of scenarios) assert.ok(s.steps.length > 0, `${s.file}: "${s.name}" has steps`);
});

// #319 adds the first-run Setup journey (fresh workspace → Setup → Skip → Home) as the 11th.
test('5 to 11 critical journeys are tagged @smoke: the app opens, a mock run reaches a gate, the gate card, Backlog Board, Roadmap, Settings, Setup', () => {
  const smoke = allScenarios().filter((s) => s.tags.includes('@smoke'));
  assert.ok(smoke.length >= 5 && smoke.length <= 11, `5 to 11 @smoke scenarios (got ${smoke.length})`);
  const text = smoke.map((s) => [s.name, ...s.steps].join('\n')).join('\n');
  for (const topic of [/gate/i, /backlog/i, /roadmap/i, /settings/i, /run/i]) assert.match(text, topic, `a @smoke journey about ${topic}`);
});

test('steps assert through role and test-id locators, and every test id they use exists in the renderer', () => {
  const steps = stepSources();
  assert.match(steps, /getByRole\(/, 'steps use getByRole');
  assert.match(steps, /getByTestId\(/, 'steps use getByTestId');
  assert.match(steps, /expect\(/, 'steps make assertions');
  // #246: the same rule as the orchestrator's check after develop (one module, so they never disagree)
  const { testIdsUsed, missingTestIds } = require('@craftorio/engine/engine/test-ids');
  const ids = testIdsUsed(steps);
  assert.ok(ids.length >= 5, `at least 5 stable test ids used by the steps (got ${ids.length})`);
  // this app's page is spread over the UI kit, the fronts and the page folder (phase 3 of the
  // reorganisation study, scripts/source-tree.js pageDirs); the default is a project's src/renderer
  const layers = require('../../../scripts/source-tree').pageDirs(root);
  const renderer = layers.flatMap((dir) => walk(path.join(...dir.split('/')), ['.js', '.html'])).map((f) => read(f)).join('\n');
  assert.match(renderer, /data-testid/, 'the renderer has data-testid attributes');
  const missing = missingTestIds(root, { renderer: layers }).map((m) => m.id);
  assert.deepEqual(missing, [], 'each test id the steps use is defined in the page\'s layers');
});

test('the old screenshot-only E2E folder test/e2e/ is gone', () => {
  const left = walk(path.join('test', 'e2e'), ['.js']);
  assert.deepEqual(left, [], 'test/e2e/ migrated to features/ and removed');
});

test('the ui-conventions skill and the JS/TS code-review rules ask for data-testid and ARIA roles on new controls', () => {
  for (const f of ['skills/ui-conventions/SKILL.md', 'skills/code-review/rules/javascript-typescript.md']) {
    const text = read(f);
    assert.match(text, /data-testid/, `${f} mentions data-testid`);
    assert.match(text, /\bARIA\b|\brole\b/i, `${f} mentions ARIA roles`);
  }
});

// CI-like run on this machine: the @smoke subset, then its JSON results (opens the app).
const skip = process.env.MULTIAGENT_UI_TESTS !== '1' ? 'set MULTIAGENT_UI_TESTS=1 to open the app' : false;
test('npm run test:e2e runs the @smoke subset green and writes JSON results', { skip, timeout: 900000 }, async () => {
  const config = await loadConfig();
  const json = (Array.isArray(config.reporter) ? config.reporter : []).find((r) => Array.isArray(r) && r[0] === 'json');
  const outputFile = json?.[1]?.outputFile;
  assert.ok(outputFile, 'the json reporter writes to a file');
  const out = path.resolve(root, outputFile);
  fs.rmSync(out, { force: true });
  const env = { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:e2e', '--', '--grep', '@smoke'], { cwd: root, env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 840000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`.slice(-4000));
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(report.stats.expected >= 5, `at least 5 smoke scenarios passed (got ${report.stats.expected})`);
  assert.equal(report.stats.unexpected, 0);
});
