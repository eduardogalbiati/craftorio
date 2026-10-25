// #360 review: the ci_runs Oracle tool (src/domains/oracle/oracle-tools.js) reads a project's recent CI runs through
// its platform's adapter (gh on GitHub, glab on GitLab) with the injected CLI runner (ctx.execCli, the
// boundary) and answers the parsed runs; issues.cliTargetOrName takes a repository URL or an owner/name
// and refuses anything else; two seed runs saved in the same millisecond get two folders (-1 suffix).
// No model is called and gh/glab are never started.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createService } = require('../src/service');
const { setupWorkspace } = require('../src/domains/workspace/workspace');
const { oracleTools, callTool } = require('../src/domains/oracle/oracle-tools');
const issues = require('../src/domains/backlog/issues');
const { runSeed, listSeedRuns } = require('../src/domains/oracle/oracle-seeds');

function makeCtx(t, execCli) {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-review-360-ws-'));
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false } });
  t.after(() => service.shutdown());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const ctx = { get ws() { return service.workspace(); }, execCli };
  return { ctx, api: service.api };
}

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-review-360-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, stdio: 'pipe' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'first commit']);
  return dir;
}

const GH_RUNS = JSON.stringify([{ databaseId: 9001, name: 'build-and-test', status: 'completed', conclusion: 'success', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:07:00Z', url: 'https://github.com/acme/widgets/actions/runs/9001' }]);
const GL_PIPELINES = JSON.stringify([{ id: 7001, ref: 'main', status: 'success', created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:09:00Z', web_url: 'https://gitlab.com/acme/widgets/-/pipelines/7001' }]);

function recorder(answer) {
  const calls = [];
  return { calls, execCli: async (cli, args) => { calls.push({ cli, args: [...args] }); return answer; } };
}

test('#360 ci_runs reads the recent CI runs of a GitHub project through gh and answers them parsed', async (t) => {
  const cli = recorder(GH_RUNS);
  const { ctx, api } = makeCtx(t, cli.execCli);
  const project = await api['projects:create']({ name: 'Widgets', folder: tmpRepo(t), repo: 'https://github.com/acme/widgets' });
  const out = await callTool(oracleTools(ctx), 'ci_runs', { projectId: project.id });
  assert.equal(out.isError, false, out.text);
  assert.equal(cli.calls.length, 1);
  assert.equal(cli.calls[0].cli, 'gh');
  assert.deepEqual(['run', 'list', 'acme/widgets'].filter((a) => !cli.calls[0].args.includes(a)), []);
  assert.match(out.text, /9001/);
  assert.match(out.text, /build-and-test/);
  assert.match(out.text, /completed/);
});

test('#360 ci_runs on a GitLab project calls the pipelines API through glab', async (t) => {
  const cli = recorder(GL_PIPELINES);
  const { ctx, api } = makeCtx(t, cli.execCli);
  await api['settings:set']({ backlogPlatform: 'gitlab' });
  const project = await api['projects:create']({ name: 'Widgets', folder: tmpRepo(t), repo: 'https://gitlab.com/acme/widgets' });
  const out = await callTool(oracleTools(ctx), 'ci_runs', { projectId: project.id });
  assert.equal(out.isError, false, out.text);
  assert.equal(cli.calls[0].cli, 'glab');
  assert.equal(cli.calls[0].args.some((a) => a.includes('pipelines')), true, cli.calls[0].args.join(' '));
  assert.match(out.text, /7001/);
  assert.match(out.text, /success/);
});

test('#360 ci_runs on an unknown project is an error and calls nothing', async (t) => {
  const cli = recorder(GH_RUNS);
  const { ctx } = makeCtx(t, cli.execCli);
  const out = await callTool(oracleTools(ctx), 'ci_runs', { projectId: 'no-such-project' });
  assert.equal(out.isError, true);
  assert.match(out.text, /Unknown project/);
  assert.equal(cli.calls.length, 0);
});

test('#360 cliTargetOrName takes a repository URL or an owner/name, and refuses anything else', () => {
  assert.equal(issues.cliTargetOrName('github', 'https://github.com/acme/widgets'), 'acme/widgets');
  assert.equal(issues.cliTargetOrName('github', 'acme/widgets'), 'acme/widgets');
  assert.equal(issues.cliTargetOrName('gitlab', 'acme/widgets'), 'acme/widgets');
  assert.throws(() => issues.cliTargetOrName('github', 'not a repository'), /repository/);
  assert.throws(() => issues.cliTargetOrName('github', ''));
  assert.throws(() => issues.cliTargetOrName('no-such-platform', 'acme/widgets'));
});

test('#360 two seed runs saved in the same millisecond get two folders, the second with a -1 suffix', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seeds-review-360-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T10:00:00.000Z') });
  const seed = { id: 'sample', meta: { name: 'sample', summary: 'A sample.', needs: [], produces: ['html'], cost: 'one turn' }, body: '# Sample\n' };
  const project = { id: 'p1', folder: root };
  const first = await runSeed({ root, project, seed, mock: true });
  const second = await runSeed({ root, project, seed, mock: true });
  assert.equal(first.date, '2026-10-15T10-00-00-000Z');
  assert.equal(second.date, '2026-10-15T10-00-00-000Z-1');
  assert.deepEqual(listSeedRuns(root, 'p1', 'sample').map((r) => r.date).sort(), [first.date, second.date].sort());
});
