// #572: each area with its own gotchas carries a nested AGENTS.md next to its code (packages/engine/,
// packages/ui-kit/, each front fronts/<id>/, scripts/): a few lines naming the topic doc to read first
// and the rules most often broken there; packages/engine/ also gets a CLAUDE.md that imports it.
// The code map lists the nested files in its folder rows.
// Seams: the files in the repository and scripts/docs.js's codeMap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const FRONTS = fs.readdirSync(path.join(root, 'fronts'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => `fronts/${d.name}`).sort();
const MAX_LINES = 20; // "at most ~15 lines": a little slack for blank lines

// folder -> the topic docs (docs/agents/<name>) its file must point to
const AREAS = {
  'packages/engine': ['engine.md', 'worktrees.md'],
  'packages/ui-kit': ['renderer.md'],
  scripts: ['windows-gotchas.md'],
  ...Object.fromEntries(FRONTS.map((f) => [f, ['renderer.md']])),
};
const nested = (folder) => path.join(root, folder, 'AGENTS.md');

// the docs/agents/... files a nested file points to, by Markdown link or by path in the text
function topicDocsNamed(folder) {
  const file = nested(folder);
  const text = read(file);
  const found = new Set();
  for (const m of text.matchAll(/\]\(([^)\s#]+)[^)]*\)/g)) {
    const abs = path.resolve(path.dirname(file), decodeURI(m[1]));
    const rel = path.relative(path.join(root, 'docs', 'agents'), abs).replace(/\\/g, '/');
    if (!rel.startsWith('..') && rel.endsWith('.md')) found.add(rel);
  }
  for (const m of text.matchAll(/docs\/agents\/([\w./-]+\.md)/g)) found.add(m[1]);
  return [...found];
}

test('the fronts folder lists at least one front (the nested files are checked per front)', () => {
  assert.ok(FRONTS.length > 0);
});

for (const [folder, topics] of Object.entries(AREAS)) {
  test(`${folder}/AGENTS.md exists, is short and points to ${topics.join(' and ')}`, () => {
    const file = nested(folder);
    assert.equal(fs.existsSync(file), true, `${folder}/AGENTS.md is missing`);
    const text = read(file);
    const lines = text.replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= MAX_LINES, `${folder}/AGENTS.md has ${lines} lines (at most ${MAX_LINES})`);

    const named = topicDocsNamed(folder);
    for (const topic of topics) assert.ok(named.includes(topic), `${folder}/AGENTS.md should point to docs/agents/${topic}`);
    const missing = named.filter((rel) => !fs.existsSync(path.join(root, 'docs', 'agents', rel)));
    assert.deepEqual(missing, [], `${folder}/AGENTS.md points to topic docs that do not exist`);
  });
}

test('packages/engine/AGENTS.md states the simulation-only rule for checks and tests', () => {
  assert.match(read(nested('packages/engine')), /simulation/i);
});

test('scripts/AGENTS.md states the Windows gotchas: EBUSY, line endings, paths', () => {
  const text = read(nested('scripts'));
  assert.match(text, /EBUSY/);
  assert.match(text, /line endings|CRLF/i);
  assert.match(text, /path/i);
});

for (const folder of ['packages/ui-kit', ...FRONTS]) {
  test(`${folder}/AGENTS.md says how to check a screen (scripts/smoke.js or npm run screenshot)`, () => {
    assert.match(read(nested(folder)), /scripts\/smoke\.js|npm run screenshot/);
  });
}

test('packages/engine/CLAUDE.md imports its AGENTS.md (@AGENTS.md, at most one comment line)', () => {
  const file = path.join(root, 'packages', 'engine', 'CLAUDE.md');
  assert.equal(fs.existsSync(file), true, 'packages/engine/CLAUDE.md is missing');
  const lines = read(file).split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.includes('@AGENTS.md'), 'packages/engine/CLAUDE.md should be `@AGENTS.md`');
  assert.ok(lines.length <= 2, `packages/engine/CLAUDE.md should hold only the import (${lines.length} lines)`);
});

test('the code map lists every nested AGENTS.md in its folder rows', () => {
  const { codeMap } = require('../scripts/docs.js');
  const map = codeMap(root);
  const rows = map.split('\n').filter((l) => l.startsWith('| `'));
  const missing = [];
  for (const folder of Object.keys(AREAS)) {
    const generic = folder.startsWith('fronts/') ? 'fronts/<id>/AGENTS.md' : null;
    const listed = rows.some((r) => r.includes(`${folder}/AGENTS.md`) || (generic && r.includes(generic)));
    if (!listed) missing.push(`${folder}/AGENTS.md`);
  }
  assert.deepEqual(missing, []);
});
