// packages/engine/engine/test-reads.js globs: the suite's selection reaches the tests that read workflow
// YAML, fragments, i18n catalogs or docs from disk through a name it cannot know statically. The #49 run
// never selected packages/ui-kit/test/workflow-inputs-localized-28.test.js (it reads workflows/<name>.yaml
// for each name of a list, through a helper), and main broke when the workflows changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readPattern, readsOf } = require('../engine/test-reads');
const { affectedTests } = require('../engine/affected-tests');
const { withoutComments } = require('../engine/source-text');

const paths = (file, text) => [...new Set(readsOf(file, withoutComments(text)).map((r) => r.path))];
const ROOT_LINE = "const ROOT = path.join(__dirname, '..', '..', '..');";

test('readsOf: a template with an unknown part names the files it may be', () => {
  const text = [
    ROOT_LINE,
    "const I18N = path.join(ROOT, 'packages', 'shared', 'i18n');",
    'for (const lang of LANGS) fs.readFileSync(path.join(I18N, `${lang}.json`));',
    "fs.readFileSync(path.join(ROOT, 'fragments', `${id}-pipeline.yaml`));",
    '',
  ].join('\n');
  assert.deepEqual(paths('packages/x/test/a.test.js', text), ['packages/shared/i18n/*.json', 'fragments/*-pipeline.yaml']);
});

test('readsOf: an unknown last argument after a literal folder names the folder\'s files; a spread, everything under it', () => {
  const text = [
    ROOT_LINE,
    "for (const f of FILES) fs.readFileSync(path.join(ROOT, 'docs', 'agents', f));",
    "fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'renderer', ...parts));",
    '',
  ].join('\n');
  assert.deepEqual(paths('packages/x/test/a.test.js', text), ['docs/agents/*', 'apps/desktop/renderer']);
});

test('readsOf: a glob keeps a literal segment: an unknown path under the root or the test folder is still no read', () => {
  const text = [
    ROOT_LINE,
    'fs.readFileSync(path.join(ROOT, f));',
    "fs.readFileSync(path.join(ROOT, '..', f));",
    'fs.readFileSync(path.join(__dirname, dir));',
    'fs.readFileSync(`${a}/${b}`);',
    "fs.readFileSync(path.join(ROOT, dir, f));",
    '',
  ].join('\n');
  assert.deepEqual(paths('packages/x/test/a.test.js', text), []);
});

test('readsOf: a helper reading a name it is given reads every file the name may be, and each literal call its own', () => {
  const text = [
    ROOT_LINE,
    "const OFFERED = ['issue', 'feature'];",
    "const load = (name, origin = 'bundled') => {",
    "  const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'workflows', `${name}.yaml`), 'utf8'));",
    '  return { ...doc, origin };',
    '};',
    "load('issue');",
    'for (const name of OFFERED) load(name);',
    'const skill = (id) => fs.readFileSync(path.join(ROOT, \'skills\', id, \'SKILL.md\'));',
    'const all = IDS.map(skill);',
    'const read = (rel) => fs.readFileSync(path.join(ROOT, rel));',
    'read(name);',
    '',
  ].join('\n');
  assert.deepEqual(paths('packages/ui-kit/test/a.test.js', text), ['workflows/*.yaml', 'workflows/issue.yaml', 'skills/**/SKILL.md']);
});

test('readPattern: `*` is any text in one segment; a glob as the last segment names files, not folders', () => {
  const yaml = readPattern('workflows/*.yaml');
  assert.equal(yaml.test('workflows/feature.yaml'), true);
  assert.equal(yaml.test('workflows/feature.yml'), false);
  assert.equal(yaml.test('workflows/sub/feature.yaml'), false);
  const files = readPattern('packages/shared/*');
  assert.equal(files.test('packages/shared/city-model.js'), true);
  assert.equal(files.test('packages/shared/i18n/en.json'), false);
  const skills = readPattern('skills/*/SKILL.md');
  assert.equal(skills.test('skills/code-review/SKILL.md'), true);
  assert.equal(skills.test('skills/code-review/rules/js.md'), false);
});

// ---- the selection --------------------------------------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function write(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
}

function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-reads-globs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  git(dir, 'init', '-q');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

const HEAD = "const fs = require('fs');\nconst path = require('path');\nconst ROOT = path.join(__dirname, '..');\n";

test('affectedTests: a changed workflow, fragment, catalog or doc selects the tests that read it by a name from a list', (t) => {
  const dir = repo(t, {
    'package.json': '{"name":"fx"}\n',
    'workflows/issue.yaml': 'name: issue\n',
    'workflows/feature.yaml': 'name: feature\n',
    'fragments/test-pipeline.yaml': 'steps: []\n',
    'i18n/en.json': '{}\n',
    'docs/agents/testing.md': '# Testing\n',
    'docs/readme/intro.md': '# Intro\n',
    'src/a.js': 'exports.a = 1;\n',
    'test/workflows.test.js': `${HEAD}const load = (name) => fs.readFileSync(path.join(ROOT, 'workflows', \`\${name}.yaml\`), 'utf8');\nfor (const n of ['issue', 'feature']) load(n);\n`,
    'test/fragments.test.js': `${HEAD}for (const id of IDS) fs.readFileSync(path.join(ROOT, 'fragments', \`\${id}-pipeline.yaml\`));\n`,
    'test/i18n.test.js': `${HEAD}for (const lang of ['en']) JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n', \`\${lang}.json\`), 'utf8'));\n`,
    'test/docs.test.js': `${HEAD}for (const f of ['testing.md']) fs.readFileSync(path.join(ROOT, 'docs', 'agents', f), 'utf8');\n`,
    'test/a.test.js': "require('../src/a');\n",
  });
  const select = (file, text) => {
    write(dir, { [file]: text });
    const sel = affectedTests({ root: dir, base: 'main' });
    git(dir, 'checkout', '-q', '--', file);
    return sel;
  };
  const feature = select('workflows/feature.yaml', 'name: feature\nsteps: []\n');
  assert.deepEqual(feature.files, ['test/workflows.test.js']);
  assert.equal(feature.reasons['test/workflows.test.js'], 'reads workflows/feature.yaml');
  assert.deepEqual(select('fragments/test-pipeline.yaml', 'steps: [x]\n').files, ['test/fragments.test.js']);
  assert.deepEqual(select('i18n/en.json', '{"a":1}\n').files, ['test/i18n.test.js']);
  assert.deepEqual(select('docs/agents/testing.md', '# Testing!\n').files, ['test/docs.test.js']);
  // a doc in another folder reaches none of them
  assert.deepEqual(select('docs/readme/intro.md', '# Intro!\n').files, []);
});

test('affectedTests (this repository): a changed bundled workflow selects workflow-inputs-localized-28, an i18n catalog its readers', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const feature = affectedTests({ root, base: 'HEAD', changed: ['workflows/feature.yaml'] });
  assert.equal(feature.mode, 'affected');
  assert.equal(feature.files.includes('packages/ui-kit/test/workflow-inputs-localized-28.test.js'), true, feature.why);
  const catalog = affectedTests({ root, base: 'HEAD', changed: ['packages/shared/i18n/pt-BR.json'] });
  assert.equal(catalog.files.includes('packages/shared/test/i18n-first-issue-28.test.js'), true, catalog.why);
});
