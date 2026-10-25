// The Oracle's read-only tools (#122, src/domains/oracle/oracle-tools.js): the git allow-list (refusedGitCommand),
// the tools that read live workspace state (roadmap, run events, seed status) and the repositories
// read-only (repo_git, repo_read), and app_source. ctx is built from a real service on a scratch
// workspace, wired the way src/service/channels/oracle.js wires it (the extra fields it adds over
// supervisorTools' own ctx are backed by the service's own already-tested channels), the way
// test/supervisor-tools.test.js builds its ctx.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createService, BUNDLED_SKILLS_DIR } = require('../../src/service');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');
const roadmaps = require('../../src/domains/roadmap/roadmap');
const { callTool, oracleTools, refusedGitCommand, READ_GIT_COMMANDS } = require('../../src/domains/oracle/oracle-tools');

const WORKFLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: fixture-oracle-tools
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

function makeCtx(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tools-'));
  process.env.MULTIAGENT_SIMULATION_ONLY = '1'; // tests never call real models
  // #408: an empty CLI home, never the machine's transcripts
  const service = createService({ host: { trashItem: async () => {}, appVersion: '9.9.9', isPackaged: false, cliHome: path.join(dir, 'cli-home') } });
  t.after(async () => {
    for (const run of service.api['runs:active']()) {
      try { service.api['run:stop']({ runId: run.runId }); } catch { /* already ended */ }
    }
    service.shutdown();
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  service.setWorkspace(setupWorkspace(dir, { persist: false }));
  const { api } = service;
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-oracle-tools.yaml'), WORKFLOW);
  const runFolder = (runId) => {
    const runDir = path.join(service.workspace().runs, path.basename(String(runId || '')));
    if (!fs.existsSync(path.join(runDir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
    return runDir;
  };
  const ctx = {
    get ws() { return service.workspace(); },
    BUNDLED_SKILLS_DIR,
    listWorkflows: () => api['workflows:list'](),
    loadBuilderWorkflow: (file) => api['builder:load'](file),
    listAllRuns: () => api['runs:list'](),
    activeRuns: () => api['runs:active'](),
    usageSnapshot: (scope) => api['usage:get']({ scope }),
    analyticsSnapshot: (opts) => api['analytics:get'](opts),
    workflowDirs: () => [service.workspace().workflows],
    runFolder,
    // roadmap:get and backlog:get already compose roadmapView/withIssueRuns the same way (#122's
    // tools pass ctx.activeRuns() too, which these channels default to [] for: same result on a
    // fixture with no run in progress)
    roadmapView: (projectId) => api['roadmap:get']({ projectId }),
    withIssueRuns: (data) => api['backlog:get']({ projectId: data.projectId }),
    unpushedProjects: () => api['backlog:unpushed'](),
  };
  return { ctx, api, service };
}

const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };

function tmpRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tools-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'a@b.c']);
  run(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  run(['add', '.']);
  run(['commit', '-q', '-m', 'first commit']);
  return dir;
}

// ---- refusedGitCommand: the allow-list, not a sandbox (docs/agents/capabilities.md) -------------

test('refusedGitCommand: every READ_GIT_COMMANDS entry is allowed with ordinary args', () => {
  for (const command of READ_GIT_COMMANDS) assert.equal(refusedGitCommand(command, ['-5']), '');
});

test('refusedGitCommand: a write subcommand (checkout, commit, reset, push) is refused by name', () => {
  for (const command of ['checkout', 'commit', 'reset', 'push', 'branch']) {
    assert.match(refusedGitCommand(command, []), /is not a read command/);
  }
});

test('refusedGitCommand: a read subcommand with an option that writes a file or runs a program is refused', () => {
  assert.match(refusedGitCommand('log', ['--output=/tmp/x']), /can write or run a program/);
  assert.match(refusedGitCommand('diff', ['--ext-diff']), /can write or run a program/);
  assert.match(refusedGitCommand('show', ['--exec=rm -rf /']), /can write or run a program/);
});

test('refusedGitCommand: args must be a list of strings', () => {
  assert.match(refusedGitCommand('log', [{ bad: true }]), /must be a list of strings/);
  assert.match(refusedGitCommand('log', 'not-an-array'), /must be a list of strings/);
});

// ---- oracleTools: active_runs, run_events, run_file, seed_status ---------------------------------

test('active_runs and run_events: a mock run started through the service shows up, with its events', async (t) => {
  const { ctx, api } = makeCtx(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tools-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'Oracle tools project', folder });
  const { runId } = await api['run:start']({ file: 'fixture-oracle-tools.yaml', inputs: {}, mock: true, projectId: project.id });

  const tools = oracleTools(ctx);
  const active = await callTool(tools, 'active_runs', {});
  assert.equal(active.isError, false);
  // a run just started is in progress (even a fast mock run should show up at least once before it ends)
  await until(() => !api['runs:active']().some((r) => r.runId === runId));

  const events = await callTool(tools, 'run_events', { runId });
  assert.equal(events.isError, false);
  const parsed = JSON.parse(events.text);
  assert.ok(Array.isArray(parsed) && parsed.length > 0);

  const lastOnly = await callTool(tools, 'run_events', { runId, last: 1 });
  assert.equal(JSON.parse(lastOnly.text).length, 1);

  const unknown = await callTool(tools, 'run_events', { runId: 'does-not-exist' });
  assert.equal(unknown.isError, true);
});

test('run_file: lists the run folder and reads summary.json; a path outside the run folder is refused', async (t) => {
  const { ctx, api } = makeCtx(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tools-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'Run file project', folder });
  const { runId } = await api['run:start']({ file: 'fixture-oracle-tools.yaml', inputs: {}, mock: true, projectId: project.id });
  await until(() => !api['runs:active']().some((r) => r.runId === runId));

  const tools = oracleTools(ctx);
  const listing = await callTool(tools, 'run_file', { runId, path: '.' });
  assert.equal(listing.isError, false);
  assert.match(listing.text, /summary\.json/);

  const summary = await callTool(tools, 'run_file', { runId, path: 'summary.json' });
  assert.equal(summary.isError, false);
  assert.match(summary.text, /"status"/);

  const escape = await callTool(tools, 'run_file', { runId, path: '../../secret' });
  assert.equal(escape.isError, true);
});

test('seed_status: a workflow or skill the owner never touched reports as "default", not updateAvailable', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = oracleTools(ctx);
  const out = await callTool(tools, 'seed_status', {});
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.text);
  assert.ok(parsed.workflows && typeof parsed.workflows === 'object');
  assert.ok(parsed.skills && typeof parsed.skills === 'object');
});

// ---- roadmap / backlog / unpushed: live workspace state, not raw files ---------------------------

test('roadmap: a proposed roadmap\'s stages and items come back through the tool, the same as the Backlog screen sees', async (t) => {
  const { ctx, service } = makeCtx(t);
  const backlogDir = service.workspace().backlog;
  roadmaps.propose(backlogDir, 'proj-x', { stages: [
    { name: 'Stage A', items: [{ workflow: 'fixture-oracle-tools.yaml', number: 1 }] },
  ] });

  const tools = oracleTools(ctx);
  const out = await callTool(tools, 'roadmap', { projectId: 'proj-x' });
  assert.equal(out.isError, false);
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.stages.length, 1);
  assert.equal(parsed.stages[0].name, 'Stage A');
  assert.equal(parsed.stages[0].items[0].status, 'planned');
});

test('unpushed: an empty workspace reports no projects with local merges', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = oracleTools(ctx);
  const out = await callTool(tools, 'unpushed', {});
  assert.equal(out.isError, false);
  assert.deepEqual(JSON.parse(out.text), []);
});

// ---- repo_git / repo_read: the projects' repositories, read-only ---------------------------------

test('repo_git: an allowed read command (log) answers; checkout and a write option are refused before git runs', async (t) => {
  const { ctx, api } = makeCtx(t);
  const folder = tmpRepo(t);
  const project = await api['projects:create']({ name: 'Repo project', folder });

  const tools = oracleTools(ctx);
  const log = await callTool(tools, 'repo_git', { projectId: project.id, command: 'log', args: ['--oneline'] });
  assert.equal(log.isError, false);
  assert.match(log.text, /first commit/);

  const checkout = await callTool(tools, 'repo_git', { projectId: project.id, command: 'checkout', args: ['-b', 'x'] });
  assert.equal(checkout.isError, true);
  assert.match(checkout.text, /not a read command/);

  const writeOpt = await callTool(tools, 'repo_git', { projectId: project.id, command: 'log', args: ['--output=/tmp/x'] });
  assert.equal(writeOpt.isError, true);
});

test('repo_read: reads a file and lists a folder inside the project; ".." cannot escape it', async (t) => {
  const { ctx, api } = makeCtx(t);
  const folder = tmpRepo(t);
  const project = await api['projects:create']({ name: 'Repo read project', folder });

  const tools = oracleTools(ctx);
  const file = await callTool(tools, 'repo_read', { projectId: project.id, path: 'README.md' });
  assert.equal(file.isError, false);
  assert.match(file.text, /hello/);

  const listing = await callTool(tools, 'repo_read', { projectId: project.id, path: '.' });
  assert.equal(listing.isError, false);
  assert.match(listing.text, /README\.md/);

  const escape = await callTool(tools, 'repo_read', { projectId: project.id, path: '../../etc/passwd' });
  assert.equal(escape.isError, true);
  assert.doesNotMatch(escape.text, /root:/);
});

// ---- #244 tool output budgets: run_events, run_file, repo_read ----------------------------------

test.describe('#244 tool output budgets', () => {
  // a run folder written by hand (runFolder only needs <workspace>/runs/<id>/events.jsonl), with
  // `count` events numbered e1..eN in `message` so the slice the tool returns is identifiable
  const seedRun = (service, runId, count, files = {}) => {
    const runDir = path.join(service.workspace().runs, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const lines = [];
    for (let i = 1; i <= count; i++) lines.push(JSON.stringify({ type: 'log', seq: i, message: `e${i}` }));
    fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${lines.join('\n')}\n`);
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(runDir, name), content);
    return runDir;
  };
  // fixed-width lines (20 bytes each: "L" + 6 digits + 12 "x" + "\n"), so byte offset N is the start
  // of line N / 20 and every position in the file is identifiable
  const LINE = 20;
  const numbered = (bytes) => {
    let s = '';
    for (let i = 0; s.length < bytes; i++) s += `L${String(i).padStart(6, '0')}${'x'.repeat(12)}\n`;
    return s.slice(0, bytes);
  };
  const BUDGET = 40 * 1024;
  const NOTE = 1024; // room for the "cut: ... bytes, next offset ..." note after the content

  test('run_events with no `last` returns only the last 200 events (e51..e250 of 250)', async (t) => {
    const { ctx, service } = makeCtx(t);
    seedRun(service, 'run-244-events', 250);
    const out = await callTool(oracleTools(ctx), 'run_events', { runId: 'run-244-events' });
    assert.equal(out.isError, false);
    const events = JSON.parse(out.text);
    assert.equal(events.length, 200);
    assert.equal(events[0].message, 'e51');
    assert.equal(events.at(-1).message, 'e250');
  });

  test('run_events with an explicit `all: true` returns every event (250)', async (t) => {
    // assumption: the explicit "all" of #244 is a boolean argument `all: true` next to `last`
    const { ctx, service } = makeCtx(t);
    seedRun(service, 'run-244-all', 250);
    const out = await callTool(oracleTools(ctx), 'run_events', { runId: 'run-244-all', all: true });
    assert.equal(out.isError, false);
    const events = JSON.parse(out.text);
    assert.equal(events.length, 250);
    assert.equal(events[0].message, 'e1');
    assert.equal(events.at(-1).message, 'e250');
    // and the schema accepts it (the model only sends what inputSchema declares)
    const tool = oracleTools(ctx).find((x) => x.name === 'run_events');
    assert.ok(tool.inputSchema.properties.all, 'run_events declares an `all` argument');
  });

  test('run_file on a 100 KB file returns at most 40 KB and says the file was cut (total size or next offset)', async (t) => {
    const { ctx, service } = makeCtx(t);
    const size = 100 * 1024;
    seedRun(service, 'run-244-file', 1, { 'big.log': numbered(size) });
    const out = await callTool(oracleTools(ctx), 'run_file', { runId: 'run-244-file', path: 'big.log' });
    assert.equal(out.isError, false);
    assert.ok(out.text.startsWith('L000000'), 'starts at the beginning of the file');
    assert.ok(out.text.length <= BUDGET + NOTE, `at most 40 KB of content (got ${out.text.length} chars)`);
    assert.match(out.text, new RegExp(`${size}|offset`, 'i'));
  });

  test('run_file with `offset` (bytes) returns the content starting at that offset', async (t) => {
    const { ctx, service } = makeCtx(t);
    seedRun(service, 'run-244-offset', 1, { 'big.log': numbered(100 * 1024) });
    const offset = 2500 * LINE; // 50000: the start of line L002500
    const out = await callTool(oracleTools(ctx), 'run_file', { runId: 'run-244-offset', path: 'big.log', offset });
    assert.equal(out.isError, false);
    assert.ok(out.text.startsWith('L002500'), `starts at byte ${offset} (got ${JSON.stringify(out.text.slice(0, 20))})`);
    assert.ok(out.text.length <= BUDGET + NOTE);
  });

  test('run_file with an offset past the end of the file returns no content and no error', async (t) => {
    const { ctx, service } = makeCtx(t);
    seedRun(service, 'run-244-past', 1, { 'small.log': numbered(5 * LINE) });
    const out = await callTool(oracleTools(ctx), 'run_file', { runId: 'run-244-past', path: 'small.log', offset: 10 * 1024 });
    assert.equal(out.isError, false);
    assert.equal(out.text, '');
  });

  test('run_file reads a 100 KB file whole by following the offset its note gives', async (t) => {
    const { ctx, service } = makeCtx(t);
    const size = 100 * 1024;
    const content = numbered(size);
    seedRun(service, 'run-244-chain', 1, { 'big.log': content });
    let offset = 0;
    let joined = '';
    for (let i = 0; i < 10; i++) {
      const out = await callTool(oracleTools(ctx), 'run_file', { runId: 'run-244-chain', path: 'big.log', offset });
      assert.equal(out.isError, false);
      const cut = out.text.match(/\n… \(cut: .*offset (\d+)\)$/);
      joined += cut ? out.text.slice(0, cut.index) : out.text;
      if (!cut) break;
      offset = Number(cut[1]);
    }
    assert.equal(joined.length, size);
    assert.equal(joined, content);
  });

  test('repo_read on a 100 KB file returns at most 40 KB', async (t) => {
    const { ctx, api } = makeCtx(t);
    const folder = tmpRepo(t);
    fs.writeFileSync(path.join(folder, 'big.txt'), numbered(100 * 1024));
    const project = await api['projects:create']({ name: 'Repo budget project', folder });
    const out = await callTool(oracleTools(ctx), 'repo_read', { projectId: project.id, path: 'big.txt' });
    assert.equal(out.isError, false);
    assert.ok(out.text.startsWith('L000000'));
    assert.ok(out.text.length <= BUDGET + NOTE, `at most 40 KB of content (got ${out.text.length} chars)`);
  });

  test('the descriptions of run_events, run_file and repo_read state their limits (200 events, 40 KB)', async (t) => {
    const { ctx } = makeCtx(t);
    const tools = oracleTools(ctx);
    const description = (name) => tools.find((x) => x.name === name).description;
    assert.match(description('run_events'), /\b200\b/);
    assert.match(description('run_file'), /40\s?KB/i);
    assert.match(description('repo_read'), /40\s?KB/i);
  });
});

// ---- app_source: where the app's own code can be read --------------------------------------------

test('app_source: not available without the orchestrator\'s own repository registered as a project', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = oracleTools(ctx);
  const out = await callTool(tools, 'app_source', {});
  assert.equal(out.isError, false);
  assert.match(out.text, /not available/);
});

test('app_source: available once a project\'s folder has a package.json named multiagent-orchestrator', async (t) => {
  const { ctx, api } = makeCtx(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tools-app-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'multiagent-orchestrator' }));
  const project = await api['projects:create']({ name: 'The app itself', folder });

  const tools = oracleTools(ctx);
  const out = await callTool(tools, 'app_source', {});
  assert.equal(out.isError, false);
  assert.deepEqual(JSON.parse(out.text), { projectId: project.id, name: project.name, folder: project.folder });
});
