// The E2E suite in two lanes (#365): the @visual scenarios run one at a time (they hold the machine's
// screenshot slot, #199), the behaviour scenarios run in N workers (N a config value, at least 2 by
// default). Checked on the Playwright config's projects: each scenario of features/*.feature, by its
// tags, falls in exactly one lane, every @visual scenario in a lane of one worker. The speed and the
// stability (3 green suites in a row) are measured in the PR, not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loadConfig = () => require('../playwright.config.js');

// Every scenario of the feature files with its tags (the feature's own and the tag lines above it),
// as the text Playwright's grep sees: the title path followed by the tags.
function scenarios() {
  const out = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'features')).filter((f) => f.endsWith('.feature'))) {
    const lines = read(path.join('features', file)).split(/\r?\n/);
    let featureTags = [];
    let pending = [];
    let feature = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('@')) { pending.push(...line.split(/\s+/).filter((w) => w.startsWith('@'))); continue; }
      const f = /^Feature:\s*(.+)$/.exec(line);
      if (f) { feature = f[1]; featureTags = pending; pending = []; continue; }
      const s = /^Scenario(?: Outline)?:\s*(.+)$/.exec(line);
      if (s) {
        const tags = [...new Set([...featureTags, ...pending])];
        out.push({ file, name: s[1], tags, text: `${file} ${feature} ${s[1]} ${tags.join(' ')}` });
        pending = [];
        continue;
      }
      if (line && !line.startsWith('#')) pending = [];
    }
  }
  return out;
}

const asList = (g) => (g == null ? [] : Array.isArray(g) ? g : [g]);
const hits = (g, text) => asList(g).some((re) => { re.lastIndex = 0; return re.test(text); });

// Whether a project (a lane) runs a scenario: its grep (or the config's) matches, its grepInvert does not.
function runs(config, project, text) {
  const grep = project.grep ?? config.grep;
  const grepInvert = project.grepInvert ?? config.grepInvert;
  if (grep != null && !hits(grep, text)) return false;
  return !(grepInvert != null && hits(grepInvert, text));
}

const lanesOf = (config, text) => config.projects.filter((p) => runs(config, p, text));

test('the config has at least two lanes (Playwright projects) (#365)', () => {
  const config = loadConfig();
  assert.ok(Array.isArray(config.projects), 'playwright.config.js defines projects');
  assert.ok(config.projects.length >= 2, `projects: ${config.projects?.length}`);
});

test('every scenario of the suite runs in exactly one lane (#365)', () => {
  const config = loadConfig();
  assert.ok(Array.isArray(config.projects), 'playwright.config.js defines projects');
  const all = scenarios();
  assert.ok(all.length > 100, `scenarios found: ${all.length}`);
  const wrong = all
    .map((s) => ({ s, n: lanesOf(config, s.text).length }))
    .filter(({ n }) => n !== 1)
    .map(({ s, n }) => `${s.file}: ${s.name} (${n} lanes)`);
  assert.deepEqual(wrong.slice(0, 10), []);
});

test('every @visual scenario runs in a lane of one worker (#365)', () => {
  const config = loadConfig();
  assert.ok(Array.isArray(config.projects), 'playwright.config.js defines projects');
  const visual = scenarios().filter((s) => s.tags.includes('@visual'));
  // 5 scenarios (8 tests with the outlines' examples) when #365 was written
  assert.ok(visual.length >= 5, `@visual scenarios found: ${visual.length}`);
  const wrong = visual
    .filter((s) => lanesOf(config, s.text).some((p) => p.workers !== 1))
    .map((s) => `${s.file}: ${s.name} (${lanesOf(config, s.text).map((p) => `${p.name}: workers ${p.workers}`).join(', ')})`);
  assert.deepEqual(wrong, []);
});

test('the behaviour scenarios run in a lane of at least 2 workers by default, which the whole run allows (#365)', () => {
  const config = loadConfig();
  assert.ok(Array.isArray(config.projects), 'playwright.config.js defines projects');
  const behaviour = scenarios().filter((s) => !s.tags.includes('@visual'));
  const parallel = behaviour.filter((s) => lanesOf(config, s.text).some((p) => typeof p.workers === 'number' && p.workers >= 2));
  // most behaviour scenarios are parallel; a few may stay serial for shared state (a reason in a comment)
  assert.ok(parallel.length >= behaviour.length * 0.8, `parallel behaviour scenarios: ${parallel.length} of ${behaviour.length}`);
  const lane = config.projects.find((p) => typeof p.workers === 'number' && p.workers >= 2);
  assert.ok(lane, 'a lane with at least 2 workers');
  assert.equal(typeof config.workers, 'number', 'the whole run sets its worker pool');
  assert.ok(config.workers >= lane.workers, `whole run ${config.workers} workers, behaviour lane ${lane.workers}`);
});

test('the suite still never retries a scenario (#365, #362)', () => {
  const config = loadConfig();
  assert.equal(config.retries, 0);
  for (const p of config.projects || []) assert.ok(p.retries == null || p.retries === 0, `${p.name}: retries ${p.retries}`);
});

// The config loaded again with MULTIAGENT_E2E_WORKERS set to value (undefined: unset)
function configWith(value) {
  const file = require.resolve('../playwright.config.js');
  const before = process.env.MULTIAGENT_E2E_WORKERS;
  delete require.cache[file];
  if (value === undefined) delete process.env.MULTIAGENT_E2E_WORKERS;
  else process.env.MULTIAGENT_E2E_WORKERS = value;
  try {
    const config = require(file);
    const lane = (name) => config.projects.find((p) => p.name === name);
    return { pool: config.workers, behaviour: lane('behaviour').workers, visual: lane('visual').workers };
  } finally {
    delete require.cache[file];
    if (before === undefined) delete process.env.MULTIAGENT_E2E_WORKERS;
    else process.env.MULTIAGENT_E2E_WORKERS = before;
  }
}

test('MULTIAGENT_E2E_WORKERS sets the behaviour lane and the pool; the visual lane stays at one worker (#365)', () => {
  assert.deepEqual(configWith(undefined), { pool: 2, behaviour: 2, visual: 1 });
  assert.deepEqual(configWith('3'), { pool: 3, behaviour: 3, visual: 1 });
  // 1 gives back the old one-Electron-at-a-time suite
  assert.deepEqual(configWith('1'), { pool: 1, behaviour: 1, visual: 1 });
});

test('an empty, zero or non-numeric MULTIAGENT_E2E_WORKERS falls back to 2 workers (#365)', () => {
  for (const value of ['', '0', 'abc']) {
    assert.deepEqual(configWith(value), { pool: 2, behaviour: 2, visual: 1 }, `MULTIAGENT_E2E_WORKERS=${JSON.stringify(value)}`);
  }
});

test('only the visual lane asks for the screenshot slot (#365)', () => {
  const config = loadConfig();
  const slot = Object.fromEntries(config.projects.map((p) => [p.name, Boolean(p.metadata?.screenshotSlot)]));
  assert.deepEqual(slot, { behaviour: false, visual: true });
});

test('a launch without the slot never takes it; a launch with it holds it until released (#365)', async (t) => {
  // the machine's slot folder lives under the OS temp folder: point it at a scratch one
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'e2e-lanes-365-'));
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, slot: process.env.MULTIAGENT_SCREENSHOT_SLOT };
  t.after(() => {
    for (const [k, v] of Object.entries({ TEMP: saved.TEMP, TMP: saved.TMP, TMPDIR: saved.TMPDIR, MULTIAGENT_SCREENSHOT_SLOT: saved.slot })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  process.env.TEMP = tmp; process.env.TMP = tmp; process.env.TMPDIR = tmp;
  delete process.env.MULTIAGENT_SCREENSHOT_SLOT;
  const machineSlot = require('../src/engine/machine-slot');
  const { screenshotSlot } = require('../features/support/app');
  assert.equal(machineSlot.machineSlotDir().startsWith(tmp), true, 'the slot folder follows the scratch temp folder');
  const held = () => machineSlot.slotHolder('screenshot', { dir: machineSlot.machineSlotDir() }) !== null;

  const free = await screenshotSlot(false);
  assert.equal(held(), false, 'the behaviour lane does not take the slot');
  free.release();

  const slot = await screenshotSlot(true);
  assert.equal(held(), true, 'the visual lane holds the slot');
  slot.release();
  assert.equal(held(), false, 'released on close');
});

test('a Playwright failure prefixed with a lane ("[behaviour] › ", "[visual] › ") is read with its feature file (#365)', () => {
  const { parseFailures } = require('../src/engine/suite-step');
  const out = [
    '  1) [behaviour] › .features-gen/features/backlog.feature.spec.js:7:7 › Backlog › Kanban board @issue-223 ',
    '',
    '    Error: expect(locator).toBeVisible() failed',
    '',
    '  2) [visual] › .features-gen/features/visual.feature.spec.js:5:7 › Visual › The Backlog Board looks like its baseline @visual ',
    '    Error: Screenshot comparison failed',
    '',
    '  2 failed',
  ].join('\n');
  const failures = parseFailures(out);
  assert.deepEqual(failures.map((f) => f.file), ['features/backlog.feature', 'features/visual.feature']);
  assert.match(failures[0].error, /toBeVisible/);
  assert.match(failures[1].error, /Screenshot comparison/);
});

test("the config's header comment describes the two lanes instead of one Electron at a time (#365)", () => {
  const header = read('playwright.config.js').split(/\r?\n/).filter((l) => l.startsWith('//')).join('\n');
  assert.match(header, /#365/);
  assert.match(header, /@visual/);
  assert.doesNotMatch(header, /One Electron at a time \(workers: 1/);
});

test('docs/agents/testing.md documents the E2E lanes (#365)', () => {
  const doc = read('docs/agents/testing.md');
  assert.match(doc, /#365/);
  assert.match(doc, /lane/i);
});

test("ci.yml's E2E job says which lanes it uses, or why it keeps one worker (#365)", () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /#365/);
});
