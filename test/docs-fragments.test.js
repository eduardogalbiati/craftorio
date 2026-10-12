// #248: README.md assembled from per-feature fragments (docs/readme/*.md, ordered by file name):
// a new feature adds a file, never edits the README.
// #251: docs/agents/engine.md split into one doc per topic (docs/agents/engine/*.md), engine.md
// being a short index generated from each topic's first heading and summary line.
// Seams: scripts/docs.js's main (`npm run docs`, `--check`), codeMap and engineIndex, on the real repository
// or on a temporary copy of what the generator reads (skills/, docs/, README.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { codeMap, engineIndex, main } = require('../scripts/docs.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const READ_ME = path.join('docs', 'readme');
const ENGINE = path.join('docs', 'agents', 'engine');
const mdFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);

// A temporary copy of what the generator reads; `withReadme: false` leaves README.md out, so the
// generator has to assemble it from the fragments alone.
function tmpRoot(t, { withReadme = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-fragments-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'skills'), path.join(tmp, 'skills'), { recursive: true });
  fs.cpSync(path.join(root, 'docs'), path.join(tmp, 'docs'), { recursive: true });
  if (withReadme) fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
  return tmp;
}

// The README without its generated blocks (what was hand-written before #248).
const handWritten = (text) => text.replace(/<!-- generated:([\w-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g, '');
const firstLine = (text) => text.split('\n').find((l) => l.trim()) || '';

// #248

test('README.md is assembled from the fragments: npm run docs on a copy with no README.md rebuilds the committed one byte for byte', (t) => {
  const tmp = tmpRoot(t, { withReadme: false });
  assert.equal(main([], tmp), 0);
  const rebuilt = read(path.join(tmp, 'README.md'));
  assert.equal(rebuilt === read(path.join(root, 'README.md')), true, 'the rebuilt README differs from the committed one');
});

test('every hand-written README section heading lives in its own docs/readme/ fragment', () => {
  const fragments = mdFiles(path.join(root, READ_ME));
  assert.ok(fragments.length > 1, `docs/readme/ should hold one fragment per section (found ${fragments.length})`);
  const texts = fragments.map((f) => read(path.join(root, READ_ME, f)));
  const headings = handWritten(read(path.join(root, 'README.md'))).split('\n').filter((l) => /^## /.test(l));
  assert.ok(headings.length >= 10, 'the README should still have its hand-written sections');
  const missing = headings.filter((h) => !texts.some((txt) => txt.split('\n').includes(h)));
  assert.deepEqual(missing, []);
});

test('a new docs/readme/ fragment makes --check report the README as stale; npm run docs adds it in name order', (t) => {
  const tmp = tmpRoot(t);
  const dir = path.join(tmp, READ_ME);
  const names = mdFiles(dir);
  assert.ok(names.length > 1, 'docs/readme/ should hold the README fragments');
  // a name that sorts right after the first fragment and before the second
  const added = names[0].replace(/\.md$/, 'x.md');
  fs.writeFileSync(path.join(dir, added), '## Zz fragment test\n\nText of the new fragment.\n');

  assert.equal(main(['--check'], tmp), 1);
  assert.equal(main([], tmp), 0);
  assert.equal(main(['--check'], tmp), 0);

  const readme = read(path.join(tmp, 'README.md'));
  const at = readme.indexOf('## Zz fragment test\n\nText of the new fragment.');
  assert.ok(at > 0, 'the new fragment should be in the README');
  const before = firstLine(read(path.join(dir, names[0])));
  const after = firstLine(read(path.join(dir, names[1])));
  assert.ok(readme.indexOf(before) < at, `the new fragment should come after ${names[0]}`);
  assert.ok(readme.indexOf(after) > at, `the new fragment should come before ${names[1]}`);
});

test('a docs/readme/ fragment edited without regenerating makes --check fail; npm run docs brings the README up to date', (t) => {
  const tmp = tmpRoot(t);
  const dir = path.join(tmp, READ_ME);
  const file = mdFiles(dir).find((f) => read(path.join(dir, f)).split('\n').includes('## Install'));
  assert.ok(file, 'one docs/readme/ fragment should hold the "## Install" section');
  fs.writeFileSync(path.join(dir, file), read(path.join(dir, file)).replace('## Install', '## Install (edited)'));

  assert.equal(main(['--check'], tmp), 1);
  assert.equal(main([], tmp), 0);
  assert.equal(main(['--check'], tmp), 0);
  assert.equal(read(path.join(tmp, 'README.md')).split('\n').includes('## Install (edited)'), true);
});

test('each docs/readme/ fragment holds one README section: at most one "## " heading outside its generated markers', () => {
  const crowded = mdFiles(path.join(root, READ_ME))
    .filter((f) => handWritten(read(path.join(root, READ_ME, f))).split('\n').filter((l) => /^## /.test(l)).length > 1);
  assert.deepEqual(crowded, []);
});

test('with no docs/readme/ fragment, npm run docs keeps README.md as its own source and writes no engine index', (t) => {
  const tmp = tmpRoot(t);
  fs.rmSync(path.join(tmp, READ_ME), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, ENGINE), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, 'docs', 'agents', 'engine.md'), { force: true });

  assert.equal(main([], tmp), 0);
  assert.equal(read(path.join(tmp, 'README.md')) === read(path.join(root, 'README.md')), true, 'the README should be unchanged');
  assert.equal(fs.existsSync(path.join(tmp, 'docs', 'agents', 'engine.md')), false);
  assert.equal(main(['--check'], tmp), 0);
});

test('--check reports a missing README.md as stale; npm run docs writes it', (t) => {
  const tmp = tmpRoot(t, { withReadme: false });
  assert.equal(main(['--check'], tmp), 1);
  assert.equal(main([], tmp), 0);
  assert.equal(main(['--check'], tmp), 0);
});

test('the docs guide (code map) says a feature adds a docs/readme/ fragment and an engine topic adds a docs/agents/engine/ file', () => {
  const map = codeMap(root);
  assert.match(map, /docs\/readme\//);
  assert.match(map, /docs\/agents\/engine\//);
});

// #251

const ENGINE_TOPICS = [
  'Agents and steps',
  'Sessions and handoff notes',
  'Resume from a step',
  'Gates, loops and how a run ends',
  'Chaining: declared outputs and `then` (#134)',
  'Saved pipelines (#135)',
  'A workflow as a step: `type: workflow` (#174)',
  'Worktrees and template context',
  'Evidence: screenshots per step and round (#146)',
  'Providers',
];

test('each of engine.md\'s ten sections is a topic file of docs/agents/engine/ (its first heading)', () => {
  const files = mdFiles(path.join(root, ENGINE));
  assert.ok(files.length >= ENGINE_TOPICS.length, `docs/agents/engine/ should hold one file per topic (found ${files.length})`);
  const titles = files.map((f) => {
    const heading = read(path.join(root, ENGINE, f)).split('\n').find((l) => /^#+ /.test(l)) || '';
    return heading.replace(/^#+ /, '');
  });
  assert.deepEqual(ENGINE_TOPICS.filter((topic) => !titles.includes(topic)), []);
});

test('docs/agents/engine.md is a short index linking every topic file, with no section of its own', () => {
  const files = mdFiles(path.join(root, ENGINE));
  assert.ok(files.length >= ENGINE_TOPICS.length);
  const index = read(path.join(root, 'docs', 'agents', 'engine.md'));
  const unlisted = files.filter((f) => !new RegExp(`\\]\\((\\./)?engine/${f.replace(/[.]/g, '\\.')}\\)`).test(index));
  assert.deepEqual(unlisted, []);
  assert.equal(/^## Agents and steps$/m.test(index), false, 'the topics\' text belongs in their own files');
  const lines = index.split('\n').filter((l) => l.trim()).length;
  assert.ok(lines <= files.length + 15, `engine.md should be a short index (${lines} non-blank lines)`);
});

test('a new docs/agents/engine/ topic makes --check fail; npm run docs lists it in engine.md with its heading and summary line', (t) => {
  const tmp = tmpRoot(t);
  fs.writeFileSync(path.join(tmp, ENGINE, 'zz-test-topic.md'),
    '# Zz test topic\n\nA one-line summary of the test topic.\n\n## Details\n\nBody of the test topic.\n');

  assert.equal(main(['--check'], tmp), 1);
  assert.equal(main([], tmp), 0);
  assert.equal(main(['--check'], tmp), 0);

  const index = read(path.join(tmp, 'docs', 'agents', 'engine.md'));
  const line = index.split('\n').find((l) => /\]\((\.\/)?engine\/zz-test-topic\.md\)/.test(l));
  assert.ok(line, 'engine.md should link the new topic file');
  assert.match(line, /Zz test topic/);
  assert.match(line, /A one-line summary of the test topic\./);
  assert.doesNotMatch(index, /Body of the test topic/);
});

// A temporary root with just docs/agents/engine/<name>.md: enough for the engine index.
function tmpEngineRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-engine-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ENGINE), { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(tmp, ENGINE, name), content);
  return tmp;
}

test('engine index: topics in file-name order; a heading followed by another heading gives no summary; '
  + 'a file with no heading is listed by its file name', (t) => {
  const tmp = tmpEngineRoot(t, {
    'b-no-summary.md': '## No summary topic\n\n### A sub-heading\n\nText.\n',
    'a-full.md': '# Full topic\n\n  Its summary line.  \n\nBody.\n',
    'c-bare.md': 'Just prose, no heading.\n',
  });
  const items = engineIndex(tmp).split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(items, [
    '- [Full topic](engine/a-full.md): Its summary line.',
    '- [No summary topic](engine/b-no-summary.md)',
    '- [c-bare](engine/c-bare.md)',
  ]);
});

test('no relative link in docs/agents/ (topic files included) or in CLAUDE.md is broken', () => {
  const agents = path.join(root, 'docs', 'agents');
  const files = [path.join(root, 'CLAUDE.md')];
  for (const dir of [agents, path.join(agents, 'engine')]) {
    // code-map.md and test-map.md are derived (gitignored), not hand-written docs
    for (const f of mdFiles(dir)) if (!['code-map.md', 'test-map.md'].includes(f)) files.push(path.join(dir, f));
  }
  const broken = [];
  for (const file of files) {
    const text = read(file).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), decodeURI(target)))) {
        broken.push(`${path.relative(root, file).replace(/\\/g, '/')} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});
