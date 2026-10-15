// Acceptance tests for #331: AGENTS.md is the repository's agent instructions (Codex reads it,
// CLAUDE.md imports it). The README and CONTRIBUTING name AGENTS.md wherever they named CLAUDE.md,
// and the capabilities doc records which project file Grok Build reads. The index itself is checked
// by test/claude-md.test.js. These checks read files only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// paragraphs (blank-line separated); inside a fenced block, each line on its own
function paragraphs(text) {
  const out = [];
  for (const [i, part] of text.split(/(```[\s\S]*?```)/).entries()) {
    if (i % 2) out.push(...part.split('\n'));
    else out.push(...part.split(/\n\s*\n/));
  }
  return out.filter((p) => p.trim());
}

for (const file of ['README.md', 'CONTRIBUTING.md']) {
  test(`${file} names AGENTS.md wherever it names CLAUDE.md`, () => {
    const text = read(file);
    assert.ok(text.includes('AGENTS.md'), `${file} never names AGENTS.md`);
    const without = paragraphs(text).filter((p) => p.includes('CLAUDE.md') && !p.includes('AGENTS.md'));
    assert.deepEqual(without.map((p) => p.trim().slice(0, 120)), []);
  });
}

test('the README\'s repository structure lists AGENTS.md as the agents\' context', () => {
  const line = read('README.md').split('\n').find((l) => l.includes('docs/agents/') && /context for coding agents/.test(l));
  assert.ok(line, 'no structure line for the agents\' context');
  assert.ok(line.includes('AGENTS.md'), line);
});

test('docs/agents/capabilities.md records which project instructions file Grok Build reads', () => {
  const text = read('docs/agents/capabilities.md');
  const found = paragraphs(text).some((p) => /grok/i.test(p) && p.includes('AGENTS.md'));
  assert.ok(found, 'no paragraph of capabilities.md names Grok and AGENTS.md');
});

test('docs/agents/capabilities.md says Codex reads AGENTS.md', () => {
  const text = read('docs/agents/capabilities.md');
  assert.ok(paragraphs(text).some((p) => /codex/i.test(p) && p.includes('AGENTS.md')), 'Codex and AGENTS.md are never named together');
});
