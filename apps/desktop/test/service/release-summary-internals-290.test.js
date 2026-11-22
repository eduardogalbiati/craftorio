// Release summary internals (#290): the template filters the review step's prompt uses
// (project_version, git_tags, git_log_stat), the gate's `report` (first in the message, apart in the
// event), the renderer's gateReportParts, and the Releases screen's source (`summary` on a release
// whose run wrote release-summary.md, releases:summary reads it).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { render } = require('@craftorio/engine/engine/workflow');
const { makeService } = require('@craftorio/engine/test/service/helpers');

const tmp = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

test('project_version reads package.json, then pyproject.toml; nothing without a version file (#290)', (t) => {
  const dir = tmp(t, 'rs-version-');
  assert.equal(render('{{ d | project_version }}', { d: dir }), '');
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "2.1.0"\n');
  assert.equal(render('{{ d | project_version }}', { d: dir }), 'pyproject.toml: 2.1.0');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "version": "0.3.0" }');
  assert.equal(render('{{ d | project_version }}', { d: dir }), 'package.json: 0.3.0');
  assert.equal(render('{{ d | project_version }}', { d: '' }), '');
});

test('git_tags lists the last tags, git_log_stat the commits since a base with their files; both empty without a repository (#290)', (t) => {
  const dir = tmp(t, 'rs-git-');
  assert.equal(render('{{ d | git_tags }}', { d: dir }), '');
  assert.equal(render('{{ d | git_log_stat("main") }}', { d: dir }), '');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', 'v0.1.0');
  git(dir, 'switch', '-q', '-c', 'fix');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\nc\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'the fix');
  assert.equal(render('{{ d | git_tags(5) }}', { d: dir }), 'v0.1.0');
  const stat = render('{{ d | git_log_stat("main") }}', { d: dir });
  assert.match(stat, /the fix/);
  assert.match(stat, /b\.txt/);
  assert.doesNotMatch(stat, /base/);
});

test('gateReportParts: the report as Markdown in release-summary, the message without it (#290)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'packages', 'ui-kit', 'gate-panel.js'), 'utf8');
  const sandbox = { window: {}, esc: (s) => String(s), markdownHtml: (s) => `<md>${s}</md>`, document: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${/function gateReportParts[\s\S]*?\n}\n/.exec(src)[0]}; window.gateReportParts = gateReportParts;`, sandbox);
  const parts = sandbox.window.gateReportParts;
  assert.deepEqual({ ...parts({ message: 'Release v1\nNot on origin yet:' }) }, { reportHtml: '', message: 'Release v1\nNot on origin yet:' });
  const r = parts({ report: '## Timeline', message: '## Timeline\n\nRelease v1' });
  assert.match(r.reportHtml, /data-testid="release-summary"/);
  assert.match(r.reportHtml, /<md>## Timeline<\/md>/);
  assert.equal(r.message, 'Release v1');
  // a message that does not start with the report (e.g. a template changed it) is left whole
  const other = parts({ report: '## Timeline', message: 'Release v1\n## Timeline' });
  assert.match(other.reportHtml, /data-testid="release-summary"/);
  assert.equal(other.message, 'Release v1\n## Timeline');
});

test('releases: a release whose run wrote release-summary.md has `summary` and releases:summary reads it (#290)', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = tmp(t, 'rs-project-');
  const p = await api['projects:create']({ name: 'demo', folder });
  const runId = '20260110-170000-rel00290';
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'release-summary.md'), 'Green.\n\n## Timeline\n');
  fs.mkdirSync(ws.releases, { recursive: true });
  fs.writeFileSync(path.join(ws.releases, `${p.id}.json`), JSON.stringify({ releases: [
    { version: 'v0.9', date: '2026-01-10T18:00:00.000Z', runs: ['x', runId], status: 'shipped' },
    { version: 'v0.8', date: '2025-12-19T18:00:00.000Z', runs: ['20251219-171500-rel00008'], status: 'shipped' },
  ] }));
  const list = api['releases:list']({ projectId: p.id });
  assert.deepEqual(list.releases.map((r) => [r.version, !!r.summary]), [['v0.9', true], ['v0.8', false]]);
  assert.deepEqual(api['releases:summary']({ projectId: p.id, version: 'v0.9' }), { version: 'v0.9', runId, text: 'Green.\n\n## Timeline\n' });
  assert.throws(() => api['releases:summary']({ projectId: p.id, version: 'v0.8' }), /no release summary/);
  assert.throws(() => api['releases:summary']({ projectId: p.id, version: 'v7' }), /No release v7/);
});
