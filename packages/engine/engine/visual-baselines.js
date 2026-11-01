// The visual baselines an issue's E2E scenarios use and the repository lacks (#696). A new @visual
// scenario carries its baseline before the review: the `type: visual_baselines` step
// (run/machine-steps.js runVisualBaselinesStep; ai-development-local-hero's baseline_check, after a
// develop commit) sends the run back to develop with the file and the update command, like the test id
// check (test-ids.js, #246):
//   - the scenarios are those tagged @issue-<n> (on the scenario or its Feature) in every .feature
//     file of the repository (node_modules and .git skipped);
//   - a screenshot name is a quoted "….png" in a step's text (a Scenario Outline's <placeholders>
//     expanded from its Examples), or the static `toHaveScreenshot('….png')` of the step definition
//     whose text the step matches ({string}, {int}, {word}… as wildcards);
//   - its baseline is features/__screenshots__/<name>-<platform>.png (playwright.config.js'
//     snapshotPathTemplate `{arg}-{platform}{ext}`), one per platform.

const fs = require('fs');
const path = require('path');
const { DEFAULT_STEPS, listFiles, stepFiles } = require('./test-ids');

const SCREENSHOTS_DIR = 'features/__screenshots__';
const STEP_KEYWORDS = /^(?:Given|When|Then|And|But|\*)\s+(.*)$/;
const SCENARIO = /^(?:Scenario|Scenario Outline|Scenario Template|Example):\s*(.*)$/;

const updateCommand = (issue) => `npm run test:e2e:update -- --grep @issue-${issue}`;
const pngNames = (text) => [...String(text).matchAll(/"([^"$`]+?\.png)"/g)].map((m) => m[1]);

// The scenarios of a .feature text: { name, tags, steps, examples: [{ <column>: value }] }; the
// Feature's tags are part of each scenario's tags.
function parseFeature(text) {
  const scenarios = [];
  let featureTags = [];
  let pending = [];
  let current = null;
  let header = null; // the Examples table's columns, once its first row is read
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) { pending.push(...line.split(/\s+/).filter((x) => x.startsWith('@'))); continue; }
    let m;
    if (/^Feature:/.test(line)) { featureTags = pending; pending = []; current = null; continue; }
    if ((m = SCENARIO.exec(line))) {
      current = { name: m[1].trim(), tags: [...featureTags, ...pending], steps: [], examples: [] };
      scenarios.push(current);
      pending = [];
      header = null;
      continue;
    }
    if (/^(?:Background|Rule):/.test(line)) { current = null; pending = []; continue; }
    if (/^(?:Examples|Scenarios):/.test(line)) { pending = []; header = null; continue; }
    if (!current) continue;
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!header) header = cells;
      else current.examples.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
      continue;
    }
    if ((m = STEP_KEYWORDS.exec(line))) current.steps.push(m[1]);
  }
  return scenarios;
}

// A scenario's step texts, once per Examples row (placeholders filled in), or as written.
function expandedSteps(scenario) {
  if (!scenario.examples.length) return scenario.steps;
  return scenario.examples.flatMap((row) => scenario.steps.map((s) => s.replace(/<([^<>]+)>/g, (all, key) => (key in row ? row[key] : all))));
}

// A Cucumber expression as a RegExp over a step's text.
function expressionRegExp(expr) {
  const escaped = String(expr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wild = escaped
    .replace(/\\\{string\\\}/g, '(?:"[^"]*"|\'[^\']*\')')
    .replace(/\\\{int\\\}/g, '-?\\d+')
    .replace(/\\\{float\\\}/g, '-?[\\d.]+')
    .replace(/\\\{word\\\}/g, '\\S+')
    .replace(/\\\{[^}]*\\\}/g, '.*');
  return new RegExp(`^${wild}$`);
}

// The step definitions with a static `toHaveScreenshot('….png')`: [{ match: RegExp, names }].
function screenshotDefinitions(root, steps) {
  const defs = [];
  for (const file of stepFiles(root, { steps })) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const starts = [...source.matchAll(/\b(?:Given|When|Then|Step)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)];
    starts.forEach((s, i) => {
      const body = source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : source.length);
      const names = [...body.matchAll(/toHaveScreenshot\(\s*(['"])([^'"$`]+?\.png)\1/g)].map((m) => m[2]);
      if (names.length) defs.push({ match: expressionRegExp(s[2].replace(/\\(.)/g, '$1')), names });
    });
  }
  return defs;
}

// One `{ name, file, feature, scenario, command }` per screenshot name the scenarios of `issues` use
// without a baseline for `platform`, each baseline file once, in the order of the .feature files.
function missingBaselines(root, { issues = [], platform = process.platform, steps = DEFAULT_STEPS } = {}) {
  const wanted = [].concat(issues).map((n) => String(n).replace(/^#/, '')).filter(Boolean);
  if (!wanted.length) return [];
  let defs = null;
  const seen = new Set();
  const out = [];
  for (const feature of listFiles(root, '', ['.feature'])) {
    for (const scenario of parseFeature(fs.readFileSync(path.join(root, feature), 'utf8'))) {
      const issue = wanted.find((n) => scenario.tags.includes(`@issue-${n}`));
      if (!issue) continue;
      const names = [];
      for (const text of expandedSteps(scenario)) {
        names.push(...pngNames(text));
        defs ??= screenshotDefinitions(root, steps);
        for (const d of defs) if (d.match.test(text)) names.push(...d.names);
      }
      for (const name of names) {
        const file = `${SCREENSHOTS_DIR}/${name.replace(/\.png$/i, '')}-${platform}.png`;
        if (seen.has(file)) continue;
        seen.add(file);
        if (!fs.existsSync(path.join(root, file))) out.push({ name, file, feature, scenario: scenario.name, command: updateCommand(issue) });
      }
    }
  }
  return out;
}

// One Markdown line per missing baseline, for a prompt: "- `file` (feature: scenario): run `command`".
function missingBaselineLines(missing) {
  return (missing || []).map((m) => `- \`${m.file}\` (${m.feature}: ${m.scenario}): run \`${m.command}\``).join('\n');
}

module.exports = {
  SCREENSHOTS_DIR,
  missingBaselineLines,
  missingBaselines,
  parseFeature,
};
