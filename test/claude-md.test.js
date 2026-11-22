// AGENTS.md holds the repository's agent instructions (#331): Codex reads it, and CLAUDE.md imports it
// (`@AGENTS.md`), so it is loaded into every Claude and Codex session in this repository (the owner's
// and every workflow agent's, on every request). It stays a short index, and the topic docs it points
// to exist.
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
// read inside each test: a missing file fails the tests that need it, not the whole file
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const linksOf = (text) => [...text.matchAll(/\]\(([^)#\s]+\.md)\)/g)].map((m) => m[1]);

test('AGENTS.md stays a short index (at most 5 KB)', () => {
  const size = Buffer.byteLength(read('AGENTS.md'));
  assert.ok(size <= MAX_BYTES, `AGENTS.md is ${size} bytes; move details to a topic doc in docs/agents/`);
});

test('every doc AGENTS.md points to exists, and every topic doc is in the index', () => {
  const links = linksOf(read('AGENTS.md'));
  assert.ok(links.length >= 5);
  for (const rel of links) assert.ok(fs.existsSync(path.join(root, rel)), `${rel} is missing`);
  const docs = fs.readdirSync(path.join(root, 'docs', 'agents')).filter((f) => f.endsWith('.md')).map((f) => `docs/agents/${f}`);
  for (const doc of docs) assert.ok(links.includes(doc), `${doc} is not listed in AGENTS.md`);
});

test('CLAUDE.md is the import of AGENTS.md, with at most one comment line', () => {
  const lines = read('CLAUDE.md').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.includes('@AGENTS.md'), 'CLAUDE.md does not import AGENTS.md (`@AGENTS.md`)');
  const others = lines.filter((l) => l !== '@AGENTS.md');
  assert.ok(others.length <= 1, `CLAUDE.md has ${others.length} lines besides the import`);
  for (const l of others) assert.equal(/\]\(/.test(l), false, `CLAUDE.md links a doc itself: ${l}`);
});

test('AGENTS.md keeps every hard rule CLAUDE.md had before the move (#331)', () => {
  // the leads of the "Hard rules" list in CLAUDE.md at 383469a, the base of #331
  const leads = [
    'Everything in the app is English',
    'Skill naming',
    'Agents run unattended',
    'The workspace is the product',
    'The supervisor works on workflows, not on the user\'s code',
    'Never let automation cross a human gate',
    'Branch + PR',
    'Real-model calls cost the owner\'s money',
    'Never start real runs in automated checks',
    'Add, don\'t edit shared lists',
  ];
  const agents = read('AGENTS.md');
  for (const lead of leads) assert.ok(agents.includes(lead), `hard rule missing from AGENTS.md: ${lead}`);
  for (const s of ['CRAFTORIO_SIMULATION_ONLY=1', 'human_approval', 'Co-Authored-By']) assert.ok(agents.includes(s), s);
});

test('AGENTS.md never names the owner\'s chat language (workflow agents answer in English, #94)', () => {
  assert.equal(/portugu[eê]s/i.test(read('AGENTS.md')), false);
});

test('AGENTS.md indexes the decisions log as the doc to read before changing decided behaviour (#332)', () => {
  const line = read('AGENTS.md').split('\n').find((l) => l.includes('](docs/agents/decisions.md)'));
  assert.ok(line, 'AGENTS.md does not link docs/agents/decisions.md');
  assert.ok(line.includes('Read before changing behaviour an earlier decision set'), line);
});

test('the code map names AGENTS.md as the index of docs/agents/', () => {
  const row = read('docs/agents/code-map.md').split('\n').find((l) => l.startsWith('| `docs/agents/` |'));
  assert.ok(row, 'no docs/agents/ row in the code map');
  assert.ok(row.includes('AGENTS.md'), row);
});

test('links between topic docs resolve', () => {
  const dir = path.join(root, 'docs', 'agents');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/\]\(([^)#\s:]+\.md)\)/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), `${f} → ${m[1]} is missing`);
  }
});
