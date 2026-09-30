// CLAUDE.md is loaded into every Claude session in this repository (the owner's and every workflow
// agent's, on every request): it stays a short index, and the topic docs it points to exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { main: generateDocs } = require('../scripts/docs.js');

const root = path.join(__dirname, '..');
const MAX_BYTES = 5 * 1024;
// docs/agents/code-map.md is generated and gitignored (#77): run the generator here too, so this
// file passes on a fresh checkout even when run outside `npm test` (whose `pretest` hook does it).
generateDocs(['--derived'], root);
const index = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
const links = [...index.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]);

test('CLAUDE.md stays a short index (at most 5 KB)', () => {
  const size = Buffer.byteLength(index.replace(/\r\n/g, '\n'));
  assert.ok(size <= MAX_BYTES, `CLAUDE.md is ${size} bytes; move details to a topic doc in docs/agents/`);
});

test('every doc CLAUDE.md points to exists, and every topic doc is in the index', () => {
  assert.ok(links.length >= 5);
  for (const rel of links) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing`);
  const docs = fs.readdirSync(path.join(root, 'docs', 'agents')).filter((f) => f.endsWith('.md')).map((f) => `docs/agents/${f}`);
  for (const doc of docs) assert.ok(links.includes(doc), `${doc} is not listed in CLAUDE.md`);
});

test('links between topic docs resolve', () => {
  const dir = path.join(root, 'docs', 'agents');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/\]\(([^)#\s:]+\.md)\)/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), `${f} → ${m[1]} is missing`);
  }
});
