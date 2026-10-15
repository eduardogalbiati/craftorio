// The flaky E2E scenarios of #362 are fixed in their steps, never by loosening the suite: the visual
// limit stays maxDiffPixelRatio 0.02, no retries, and the three scenarios (the run list's progress
// strip after a search, the hours heatmap in light and dark) stay in the release, untagged out and
// with their baselines committed. The fixes themselves are proven by the E2E runs (@issue-362).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// the tag line right above each scenario, by scenario title
function scenarioTags(feature) {
  const lines = read(feature).split(/\r?\n/);
  const out = {};
  lines.forEach((line, i) => {
    const m = /^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = (lines[i - 1] || '').trim().split(/\s+/).filter((w) => w.startsWith('@'));
  });
  return out;
}

test('the visual limit stays maxDiffPixelRatio 0.02 and scenarios are not retried (#362)', () => {
  const config = require('../playwright.config.js');
  assert.equal(config.expect.toHaveScreenshot.maxDiffPixelRatio, 0.02);
  assert.equal(config.retries, 0);
});

test('the three #362 scenarios stay in the release suite, not skipped or tagged out (#362)', () => {
  const heat = scenarioTags('features/analytics.feature');
  const names = scenarioTags('features/display-names.feature');
  const scenarios = [
    heat['The hours heatmap and its legend in the light theme'],
    heat['The hours heatmap and its legend in the dark theme'],
    names["The run list's progress strip names the steps readably, the step ids in their tooltips"],
  ];
  for (const tags of scenarios) {
    assert.ok(Array.isArray(tags), 'the scenario still exists under its title');
    assert.ok(tags.includes('@issue-362'));
    assert.deepEqual(tags.filter((tag) => /^@(skip|fixme|fail|flaky|only|wip|manual)$/i.test(tag)), []);
  }
});

test('the two hours heatmap baselines are committed (#362)', () => {
  for (const theme of ['light', 'dark']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'features', '__screenshots__', `analytics-hours-heatmap-${theme}-win32.png`)), theme);
  }
});
