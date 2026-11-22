// #782: architecture:city says when the project was last analyzed (through makeService, on a real git repository, as
// apps/desktop/test/service/architecture-city-371.test.js). Acceptance tests, written before the code.
//
// The contract these tests assume: the answer of architecture:city gains
// analysed: { date, commit, commitsSince } | null: from the last saved report (its date, head.commit short);
// commitsSince = the commits on HEAD after that commit; null with no report.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const arch = require('@craftorio/engine/domains/oracle/oracle-architecture');

const DATE = '2026-10-20T10:00:00.000Z';

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

function repo(t) {
  const dir = tmp(t, 'city782-repo-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const commit = (name) => {
    fs.writeFileSync(path.join(dir, name), 'module.exports = 1;\n');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', name);
  };
  git('init', '-q');
  commit('a.js');
  return { dir, commit, head: () => git('rev-parse', 'HEAD') };
}

async function setup(t) {
  const { service, api } = makeService(t);
  const r = repo(t);
  const project = await api['projects:create']({ name: 'city', folder: r.dir });
  const saveReport = (commit) => arch.saveReport(service.workspace().architecture, project.id, {
    date: DATE, head: { commit, date: DATE }, branch: 'main', costUsd: 0, tokens: null, simulated: true, report: { summary: 'A fixture.', areas: [], findings: [] },
  });
  return { analysed: async () => (await api['architecture:city']({ projectId: project.id })).analysed, saveReport, repo: r };
}

test('#782 architecture:city with no report answers analysed null', async (t) => {
  const { analysed } = await setup(t);
  assert.equal(await analysed(), null);
});

test('#782 a report at HEAD answers its date, its short commit and no commit since', async (t) => {
  const { analysed, saveReport, repo: r } = await setup(t);
  const head = r.head();
  saveReport(head);
  const out = await analysed();
  assert.equal(out?.date, DATE);
  assert.equal(out?.commitsSince, 0);
  assert.equal(head.startsWith(String(out?.commit)), true, `${out?.commit} is the start of ${head}`);
  assert.equal(String(out?.commit).length < head.length, true, 'short');
});

test('#782 two commits after the report answers commitsSince 2', async (t) => {
  const { analysed, saveReport, repo: r } = await setup(t);
  saveReport(r.head());
  r.commit('b.js');
  r.commit('c.js');
  assert.equal((await analysed())?.commitsSince, 2);
});
