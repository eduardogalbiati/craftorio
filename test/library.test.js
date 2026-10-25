// Workspace projects, skills and settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../src/projects');
const skills = require('../src/domains/agents/skills');
const { setupWorkspace, readSettings, writeSettings, DEFAULT_SETTINGS } = require('../src/workspace');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const memStore = () => ({ value: null, get() { return this.value; }, set(v) { this.value = v; } });

test('setupWorkspace creates projects/ and skills/', (t) => {
  const ws = setupWorkspace(path.join(tmp(t), 'w'), { store: memStore() });
  assert.ok(fs.statSync(ws.projects).isDirectory());
  assert.ok(fs.statSync(ws.skills).isDirectory());
});

test('settings: defaults, merge and dropping unknown keys', (t) => {
  const ws = setupWorkspace(path.join(tmp(t), 'w'), { store: memStore() });
  // #273: an unset time zone reads as this computer's (DEFAULT_SETTINGS keeps null, unsaved)
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.deepEqual(readSettings(ws), { ...DEFAULT_SETTINGS, timeZone: systemZone });
  const s = writeSettings(ws, { developerMode: true, junk: 1 });
  assert.equal(s.developerMode, true);
  assert.equal('junk' in readSettings(ws), false);
});

// #82: voice input (src/domains/chat/speech.js) defaults to whisper-cli, the "small" model and Portuguese (the
// owner dictates in Portuguese); an unrelated settings patch keeps them.
test('settings: voice input defaults (whisper-cli, small, pt), kept by an unrelated patch', (t) => {
  const ws = setupWorkspace(path.join(tmp(t), 'w'), { store: memStore() });
  assert.deepEqual(
    { voiceCommand: DEFAULT_SETTINGS.voiceCommand, voiceModel: DEFAULT_SETTINGS.voiceModel, voiceLanguage: DEFAULT_SETTINGS.voiceLanguage },
    { voiceCommand: 'whisper-cli', voiceModel: 'small', voiceLanguage: 'pt' },
  );
  const s = writeSettings(ws, { developerMode: true });
  assert.equal(s.voiceCommand, 'whisper-cli');
  assert.equal(s.voiceModel, 'small');
  assert.equal(s.voiceLanguage, 'pt');
});

// #162: Keep awake (src/host/keep-awake.js) is off by default, and an unrelated patch keeps it as is.
test('settings: keep awake is off by default, kept by an unrelated patch', (t) => {
  const ws = setupWorkspace(path.join(tmp(t), 'w'), { store: memStore() });
  assert.equal(DEFAULT_SETTINGS.keepAwake, false);
  assert.equal(readSettings(ws).keepAwake, false);
  const s = writeSettings(ws, { developerMode: true });
  assert.equal(s.keepAwake, false);
  const s2 = writeSettings(ws, { keepAwake: true });
  assert.equal(s2.keepAwake, true);
  assert.equal(writeSettings(ws, { developerMode: false }).keepAwake, true);
});

test('slugify strips accents and special characters', () => {
  assert.equal(projects.slugify('Café Déjà Vu!'), 'cafe-deja-vu');
  assert.equal(projects.slugify('***'), 'project');
});

test('project without a folder creates <projects>/<id>; ids do not collide', async (t) => {
  const dir = path.join(tmp(t), 'projects');
  const a = await projects.createProject(dir, { name: 'App' });
  const b = await projects.createProject(dir, { name: 'App' });
  assert.equal(a.folder, path.join(dir, 'app'));
  assert.equal(b.id, 'app-2');
  assert.ok(a.exists);
  assert.deepEqual(projects.listProjects(dir).map((p) => p.id), ['app', 'app-2']);
});

test('project with a repository clones into the folder; a non-empty folder is refused', async (t) => {
  const root = tmp(t);
  const dir = path.join(root, 'projects');
  const calls = [];
  const git = async (args) => { calls.push(args); if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };
  const p = await projects.createProject(dir, { name: 'Lib', repo: 'https://github.com/o/r.git' }, { git });
  assert.equal(calls[0][0], 'clone');
  assert.ok(p.isGit);
  assert.equal(p.repo, 'https://github.com/o/r.git');

  const busy = path.join(root, 'busy');
  fs.mkdirSync(busy);
  fs.writeFileSync(path.join(busy, 'x.txt'), '1');
  await assert.rejects(projects.createProject(dir, { name: 'X', folder: busy, repo: 'https://github.com/o/x' }, { git }), /is not empty/);
});

test('project update and remove do not delete the folder', async (t) => {
  const dir = path.join(tmp(t), 'projects');
  const p = await projects.createProject(dir, { name: 'App' });
  assert.equal(projects.updateProject(dir, p.id, { description: 'new' }).description, 'new');
  assert.throws(() => projects.updateProject(dir, p.id, { folder: path.join(dir, 'does-not-exist') }), /does not exist/);
  projects.removeProject(dir, p.id);
  assert.equal(projects.listProjects(dir).length, 0);
  assert.ok(fs.existsSync(p.folder));
});

test('skills: create, read frontmatter, save and list', (t) => {
  const dir = tmp(t);
  const s = skills.createSkill(dir, { name: 'Code Review', description: 'Checklist: review diffs', body: '# Steps\n- read' });
  assert.equal(s.id, 'code-review');
  assert.equal(s.name, 'code-review');
  assert.equal(s.description, 'Checklist: review diffs');
  assert.match(fs.readFileSync(path.join(dir, 'code-review', 'SKILL.md'), 'utf8'), /^---\nname: code-review\n/);
  assert.throws(() => skills.createSkill(dir, { name: 'code review' }), /already exists/);

  const saved = skills.saveSkill(dir, 'code-review', { description: 'other', body: 'body' });
  assert.equal(saved.description, 'other');
  assert.equal(saved.body.trim(), 'body');
  assert.deepEqual(skills.listSkills(dir).map((x) => x.id), ['code-review']);
});

test('resolveSkill: workspace takes precedence and nested support files are listed', (t) => {
  const wsDir = tmp(t);
  const bundled = tmp(t);
  skills.createSkill(bundled, { name: 'rev', description: 'bundled', body: 'BUNDLED' });
  fs.mkdirSync(path.join(bundled, 'rev', 'rules'));
  fs.writeFileSync(path.join(bundled, 'rev', 'rules', 'go.md'), '# go');
  assert.equal(skills.resolveSkill([wsDir, bundled], 'rev').body.trim(), 'BUNDLED');
  assert.deepEqual(skills.resolveSkill([wsDir, bundled], 'rev').files, ['rules/go.md']);

  skills.createSkill(wsDir, { name: 'rev', description: 'from the user', body: 'FROM USER' });
  const s = skills.resolveSkill([wsDir, bundled], 'rev');
  assert.equal(s.body.trim(), 'FROM USER');
  const block = skills.skillPrompt(s);
  assert.match(block, /^<skill name="rev" dir=".+">\nFROM USER/);
  assert.throws(() => skills.resolveSkill([wsDir], 'nothing'), /Skill not found/);
});

test('seedSkills copies the bundled skills only once', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'skills');
  skills.createSkill(src, { name: 'a', body: 'A' });
  fs.mkdirSync(path.join(src, 'a', 'rules'));
  fs.writeFileSync(path.join(src, 'a', 'rules', 'x.md'), 'x');
  assert.deepEqual(skills.seedSkills(src, dest), ['a']);
  assert.ok(fs.existsSync(path.join(dest, 'a', 'rules', 'x.md')));

  // edited by the user: not overwritten
  fs.writeFileSync(path.join(dest, 'a', 'SKILL.md'), '---\nname: a\n---\nEDITED');
  assert.deepEqual(skills.seedSkills(src, dest), []);
  assert.match(fs.readFileSync(path.join(dest, 'a', 'SKILL.md'), 'utf8'), /EDITED/);

  // deleted by the user: does not come back; new skill in the app: gets copied
  fs.rmSync(path.join(dest, 'a'), { recursive: true });
  skills.createSkill(src, { name: 'b', body: 'B' });
  assert.deepEqual(skills.seedSkills(src, dest), ['b']);
  assert.equal(fs.existsSync(path.join(dest, 'a')), false);
  assert.deepEqual(skills.listSkills(dest).map((s) => s.id), ['b']);
});

test('seedSkills updates untouched copies when the app ships a new version', (t) => {
  const src = tmp(t);
  const dest = path.join(tmp(t), 'skills');
  skills.createSkill(src, { name: 'a', body: 'V1' });
  skills.createSkill(src, { name: 'b', body: 'V1' });
  fs.mkdirSync(path.join(src, 'a', 'rules'));
  fs.writeFileSync(path.join(src, 'a', 'rules', 'old.md'), 'old');
  skills.seedSkills(src, dest);

  fs.writeFileSync(path.join(dest, 'b', 'SKILL.md'), '---\nname: b\n---\nMINE'); // user edit
  skills.saveSkill(src, 'a', { body: 'V2' });
  skills.saveSkill(src, 'b', { body: 'V2' });
  fs.renameSync(path.join(src, 'a', 'rules', 'old.md'), path.join(src, 'a', 'rules', 'new.md'));

  assert.deepEqual(skills.seedSkills(src, dest), ['a']);
  assert.match(fs.readFileSync(path.join(dest, 'a', 'SKILL.md'), 'utf8'), /V2/);
  assert.deepEqual(fs.readdirSync(path.join(dest, 'a', 'rules')), ['new.md']); // stale files removed
  assert.match(fs.readFileSync(path.join(dest, 'b', 'SKILL.md'), 'utf8'), /MINE/);
  assert.deepEqual(skills.seedSkills(src, dest), []); // idempotent
});

test('skills bundled with the app are valid and the referenced files exist', () => {
  const dir = path.join(__dirname, '..', 'skills');
  const list = skills.listSkills(dir);
  for (const id of ['arena-synthesis', 'code-review', 'prd-writing']) assert.ok(list.some((s) => s.id === id), id);
  for (const s of list) {
    assert.equal(s.name, s.id, `${s.id}: frontmatter name = folder`);
    assert.ok(s.description.length > 40, `${s.id}: description`);
  }
  const review = skills.resolveSkill([dir], 'code-review');
  const cited = [...review.body.matchAll(/`(rules\/[\w-]+\.md)`/g)].map((m) => m[1]);
  assert.ok(cited.length >= 5);
  for (const f of cited) assert.ok(review.files.includes(f), `code-review references ${f}, which does not exist`);
});

// The skill parser swallows a YAML error (empty meta): parse each bundled frontmatter strictly, so an
// unquoted ": " in a description (#241, skills/oracle) fails here instead of silently losing the fields.
test('every bundled SKILL.md frontmatter parses with js-yaml and has name, description and summary', () => {
  const yaml = require('js-yaml');
  const dir = path.join(__dirname, '..', 'skills');
  const ids = fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'SKILL.md')));
  assert.ok(ids.includes('oracle'));
  for (const id of ids) {
    const text = fs.readFileSync(path.join(dir, id, 'SKILL.md'), 'utf8');
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(m, `${id}: has a frontmatter block`);
    let meta;
    assert.doesNotThrow(() => { meta = yaml.load(m[1]); }, `${id}: frontmatter is valid YAML`);
    assert.equal(meta.name, id, `${id}: name`);
    for (const field of ['description', 'summary']) {
      assert.equal(typeof meta[field], 'string', `${id}: ${field} is a string`);
      assert.ok(meta[field].trim().length > 0, `${id}: ${field} is not empty`);
    }
  }
});

// Language/platform skills follow `<capability>-<suffix>` and every workflow input value
// must resolve to an existing skill (e.g. language: go → unit-test-writer-go).
test('every templated skill in the workflows resolves for every enum input value', () => {
  const nunjucks = require('nunjucks');
  const { loadWorkflow } = require('../src/engine/workflow');
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'skills');
  for (const file of fs.readdirSync(path.join(root, 'workflows'))) {
    const wf = loadWorkflow(path.join(root, 'workflows', file));
    const names = [...Object.values(wf.agents).flatMap((a) => a.skills || []), ...wf.steps.flatMap((s) => s.skills || [])];
    // cartesian product of the enum inputs the skill names use (defaults for the others; e.g.
    // ai-arena's ten contender enums would make millions of combinations for nothing)
    let combos = [{}];
    for (const [k, def] of Object.entries(wf.inputs || {})) {
      const used = names.some((n) => n.includes(`inputs.${k}`));
      const values = def.enum && used ? def.enum : [def.default];
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
    }
    for (const inputs of combos) {
      for (const n of names) {
        const id = nunjucks.renderString(n, { inputs });
        if (!id) continue; // optional skill left empty (e.g. document_skill): the engine skips it, as loadSkills does
        assert.doesNotThrow(() => skills.resolveSkill([dir], id), `${file}: ${n} → ${id}`);
      }
    }
  }
});

test('language and platform skill families are complete', () => {
  const ids = skills.listSkills(path.join(__dirname, '..', 'skills')).map((s) => s.id);
  const families = {
    'unit-test-writer': ['js', 'python', 'go', 'java', 'csharp', 'rust'],
    'e2e-test-writer': ['js', 'python', 'go', 'java', 'csharp', 'rust'],
    'build-audit': ['js', 'python', 'go', 'java', 'csharp', 'rust'],
    'ci-pipeline': ['gh', 'gl'],
    'pr-babysitter': ['gh', 'gl'],
    'pr-screenshots': ['gh', 'gl'],
    deploy: ['gh', 'gl'],
    'issue-creator': ['gh', 'gl'],
    'backlog-refresh': ['gh', 'gl'],
  };
  for (const [cap, suffixes] of Object.entries(families)) {
    for (const s of suffixes) assert.ok(ids.includes(`${cap}-${s}`), `missing ${cap}-${s}`);
    const extra = ids.filter((id) => id.startsWith(`${cap}-`) && !suffixes.includes(id.slice(cap.length + 1)));
    assert.deepEqual(extra, [], `${cap}: suffix not in the family list`);
  }
});

test('saveSkill keeps extra frontmatter fields such as uses', (t) => {
  const dir = tmp(t);
  skills.createSkill(dir, { name: 'x', description: 'd', body: 'B' });
  const file = path.join(dir, 'x', 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('---\n\n', 'uses:\n  - core\n---\n\n'));
  assert.deepEqual(skills.readSkill(dir, 'x').uses, ['core']);
  skills.saveSkill(dir, 'x', { description: 'd2', body: 'B2' });
  const saved = skills.readSkill(dir, 'x');
  assert.deepEqual([saved.description, saved.uses, saved.body.trim()], ['d2', ['core'], 'B2']);
});

test('every `uses` dependency of the bundled skills exists', () => {
  const dir = path.join(__dirname, '..', 'skills');
  for (const s of skills.listSkills(dir)) {
    for (const dep of s.uses) assert.doesNotThrow(() => skills.resolveSkill([dir], dep), `${s.id} uses missing skill ${dep}`);
  }
});

test('a project with a repository and no folder is cloned into <workspace>/repos/<owner>-<repo>', async (t) => {
  const dir = path.join(tmp(t), 'projects');
  const reposDir = path.join(tmp(t), 'repos');
  const calls = [];
  const git = async (args) => { calls.push(args); if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };
  const p = await projects.createProject(dir, { name: 'Orchestrator', repo: 'git@github.com:acme/multiagent-orchestrator.git' }, { git, reposDir });
  assert.equal(p.folder, path.join(reposDir, 'acme-multiagent-orchestrator'));
  assert.deepEqual(calls[0], ['clone', 'git@github.com:acme/multiagent-orchestrator.git', p.folder]);
  assert.equal(p.isGit, true);
  // no repository: still an empty folder under projects/
  const q = await projects.createProject(dir, { name: 'Docs' }, { git, reposDir });
  assert.equal(q.folder, path.join(dir, 'docs'));
});
