// apps/desktop/renderer/agent-colors.js (#224): a fixed colour per agent role instead of a hash of its name.
// UMD like workflow-inputs.js (window.AgentColors in the renderer, module.exports in Node), so it is
// required directly here.
// - colorFor(agent, def): the agent's colour; `def` is its workflow definition, whose `color:
//   "#RRGGBB"` wins over the role map; an agent in neither falls back to the name hash (hsl).
// - chip(agent, def, theme): { background, text } as #RRGGBB for a coloured chip in 'light' or
//   'dark' theme; the text is a shade of the same colour readable on it (contrast >= 4.5:1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const load = () => require(path.join(__dirname, '..', 'renderer', 'agent-colors.js'));

const ROLES = {
  developer: '#4C7DFF',
  reviewer: '#A06BFF',
  test_writer: '#FF8A3D',
  healer: '#F0569B',
  verifier: '#2FBF71',
  evidence: '#1FC2D6',
  builder: '#E6C229',
  orchestrator: '#8C96A8',
};

// WCAG relative luminance and contrast ratio of two #RRGGBB colours
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('colorFor: each development role has its fixed colour', () => {
  const { colorFor } = load();
  for (const [agent, hex] of Object.entries(ROLES)) assert.equal(String(colorFor(agent)).toUpperCase(), hex, agent);
});

test('colorFor: the eight role colours are all different', () => {
  const { colorFor } = load();
  const colors = Object.keys(ROLES).map((a) => String(colorFor(a)).toUpperCase());
  assert.equal(new Set(colors).size, colors.length);
});

test('colorFor: an agent of a custom workflow falls back to a stable colour from its name, not a role colour', () => {
  const { colorFor } = load();
  const c = colorFor('my_custom_bot');
  assert.match(String(c), /^hsl\(/);
  assert.equal(colorFor('my_custom_bot'), c);
  assert.ok(!Object.values(ROLES).includes(String(c).toUpperCase()));
  assert.notEqual(colorFor('another_bot'), c);
});

test('colorFor: a workflow\'s `color` wins over the role map and over the fallback', () => {
  const { colorFor } = load();
  assert.equal(String(colorFor('developer', { color: '#123456' })).toUpperCase(), '#123456');
  assert.equal(String(colorFor('my_custom_bot', { color: '#ABCDEF' })).toUpperCase(), '#ABCDEF');
});

test('colorFor: every agent of the bundled development workflows has its role colour', () => {
  const { colorFor } = load();
  const dir = path.join(__dirname, '..', '..', '..', 'workflows');
  for (const file of ['software-development.yaml', 'software-development-local-hero.yaml', 'ai-development-local-hero.yaml']) {
    const wf = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const [agent, def] of Object.entries(wf.agents || {})) {
      if (!ROLES[agent]) continue;
      assert.equal(String(colorFor(agent, def)).toUpperCase(), ROLES[agent], `${file}: ${agent}`);
    }
    for (const agent of ['developer', 'reviewer', 'test_writer', 'verifier', 'evidence', 'builder']) {
      assert.ok(wf.agents?.[agent], `${file} declares ${agent}`);
    }
  }
});

test('chip: in both themes, the text on a role\'s chip has a contrast of at least 4.5:1', () => {
  const { chip } = load();
  for (const theme of ['light', 'dark']) {
    for (const agent of Object.keys(ROLES)) {
      const c = chip(agent, undefined, theme);
      assert.match(c.background, /^#[0-9a-f]{6}$/i, `${agent} ${theme} background`);
      assert.match(c.text, /^#[0-9a-f]{6}$/i, `${agent} ${theme} text`);
      assert.ok(contrast(c.text, c.background) >= 4.5, `${agent} (${theme}): ${c.text} on ${c.background} is ${contrast(c.text, c.background).toFixed(2)}:1`);
    }
  }
});

// #227: roleChip(agent, def, theme) is the HTML of the small chip by an agent's name: its role in
// words ("test writer"), with chip()'s background and text colours.
test('roleChip: the chip names the role in words, in the role\'s chip colours, in both themes', () => {
  const { roleChip, chip } = load();
  for (const theme of ['light', 'dark']) {
    for (const [agent, label] of [['test_writer', 'test writer'], ['developer', 'developer'], ['reviewer', 'reviewer']]) {
      const html = roleChip(agent, undefined, theme);
      const c = chip(agent, undefined, theme);
      assert.match(html, /class="[^"]*agent-chip[^"]*"/, `${agent} ${theme}: an agent-chip element`);
      assert.match(html, new RegExp(`>${label}<`), `${agent} ${theme}: says "${label}"`);
      assert.match(html, new RegExp(`background(-color)?:\\s*${c.background}`, 'i'), `${agent} ${theme}: chip background`);
      assert.match(html, new RegExp(`(^|[;"\\s])color:\\s*${c.text}`, 'i'), `${agent} ${theme}: chip text colour`);
    }
  }
});

test('roleChip: a workflow\'s `color` wins, and a custom agent\'s name is escaped', () => {
  const { roleChip, chip } = load();
  assert.match(roleChip('developer', { color: '#123456' }, 'dark'), new RegExp(chip('developer', { color: '#123456' }, 'dark').background, 'i'));
  const html = roleChip('<b>bot</b>', undefined, 'dark');
  assert.doesNotMatch(html, /<b>bot<\/b>/);
  assert.match(html, /&lt;b&gt;bot&lt;\/b&gt;/);
});

test('the run chat colours its agents through AgentColors, not only the name hash', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'runchat', 'runchat.js'), 'utf8');
  assert.match(src, /AgentColors\.(colorFor|chip)\(/);
});
