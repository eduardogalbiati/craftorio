// The supervisor's read-only tools over the service (#28, packages/engine/domains/supervisor/supervisor-tools.js): workflows,
// projects, runs, skills, agents and usage, served to the supervisor's MCP session. ctx is built
// from a real service on a scratch workspace (as test/service/*.test.js does), wired the same way
// fronts/build/engine/channels/supervisor.js wires it, since ctx itself is internal to packages/engine/service/index.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, BUNDLED_WORKFLOWS_DIR } = require('../../service');
const { setupWorkspace } = require('../../domains/workspace/workspace');
const { callTool, describeTools, supervisorTools, MAX_CHARS } = require('../../domains/supervisor/supervisor-tools');

const WORKFLOW = `apiVersion: craftorio/v1
kind: Workflow
metadata:
  name: fixture-supervisor-tools
agents:
  a: { provider: claude, model: m, session: ephemeral }
steps:
  - id: work
    agent: a
    prompt: "do the work"
`;

// Builds the ctx supervisorTools(ctx) expects, out of a real service's public api + workspace
// (the same functions fronts/build/engine/channels/supervisor.js hands it), never its private internals.
function makeCtx(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-tools-'));
  process.env.CRAFTORIO_SIMULATION_ONLY = '1'; // tests never call real models
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
  fs.writeFileSync(path.join(service.workspace().workflows, 'fixture-supervisor-tools.yaml'), WORKFLOW);
  const ctx = {
    get ws() { return service.workspace(); },
    listWorkflows: () => api['workflows:list'](),
    loadBuilderWorkflow: (file) => api['builder:load'](file),
    listAllRuns: () => api['runs:list'](),
    activeRuns: () => api['runs:active'](),
    usageSnapshot: (scope) => api['usage:get']({ scope }),
    analyticsSnapshot: (opts) => api['analytics:get'](opts),
    workflowDirs: () => [service.workspace().workflows, BUNDLED_WORKFLOWS_DIR],
    runFolder: (runId) => {
      const runDir = path.join(service.workspace().runs, path.basename(String(runId || '')));
      if (!fs.existsSync(path.join(runDir, 'events.jsonl'))) throw new Error(`Run not found: ${runId}`);
      return runDir;
    },
  };
  return { ctx, api, service };
}

const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn()); };

test('callTool: list_workflows, list_projects, list_skills, list_agents and get_usage all answer with isError false and parseable JSON', async (t) => {
  const { ctx, api } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const workflows = await callTool(tools, 'list_workflows', {});
  assert.equal(workflows.isError, false);
  assert.ok(JSON.parse(workflows.text).some((w) => w.file === 'fixture-supervisor-tools.yaml'));

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-tools-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'Demo project', folder });
  const projects = await callTool(tools, 'list_projects', {});
  assert.equal(projects.isError, false);
  assert.deepEqual(JSON.parse(projects.text).map((p) => p.id), [project.id]);

  const skills = await callTool(tools, 'list_skills', {});
  assert.equal(skills.isError, false);
  assert.ok(Array.isArray(JSON.parse(skills.text)));

  const agents = await callTool(tools, 'list_agents', {});
  assert.equal(agents.isError, false);
  assert.ok(JSON.parse(agents.text).some((a) => a.id === 'supervisor'));

  const usage = await callTool(tools, 'get_usage', {});
  assert.equal(usage.isError, false);
  assert.ok('budgets' in JSON.parse(usage.text) || typeof JSON.parse(usage.text) === 'object');
});

test('list_workflows on the bundled workflows stays under MAX_CHARS and parses (#161: backlog-refresh.yaml once pushed it over)', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const out = await callTool(tools, 'list_workflows', {});
  assert.equal(out.isError, false);
  assert.ok(out.text.length <= MAX_CHARS, `list_workflows is ${out.text.length} chars, over MAX_CHARS (${MAX_CHARS}): clip() would cut it mid-string`);
  const list = JSON.parse(out.text);
  assert.equal(list.length, ctx.listWorkflows().length);
});

test('list_agents on the bundled workflows stays under MAX_CHARS and parses, without prompts or avatars', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const out = await callTool(tools, 'list_agents', {});
  assert.equal(out.isError, false);
  assert.ok(out.text.length <= MAX_CHARS, `list_agents is ${out.text.length} chars, over MAX_CHARS (${MAX_CHARS}): clip() would cut it mid-string`);
  const list = JSON.parse(out.text);
  assert.ok(list.some((a) => a.id === 'supervisor'));
  for (const agent of list) {
    assert.ok(!('prompt' in agent), `${agent.id} carries its prompt`);
    assert.ok(!('appearance' in agent), `${agent.id} carries its avatar`);
  }
});

test('list_workflows items carry only the fields the tool describes, not the Workflows screen\'s builderProblems or update/bundle flags', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const out = await callTool(tools, 'list_workflows', {});
  const list = JSON.parse(out.text);
  const described = ['agents', 'category', 'description', 'file', 'inputs', 'name', 'origin', 'outputs', 'steps', 'tags', 'version'];
  const item = list.find((w) => w.file === 'fixture-supervisor-tools.yaml');
  assert.ok(Object.keys(item).every((k) => described.includes(k)), `unexpected field in ${Object.keys(item)}`);
  const bundled = list.find((w) => w.file === 'feature.yaml');
  assert.deepEqual(Object.keys(bundled).sort(), described.sort());
  for (const w of list) {
    assert.ok(!('builderProblems' in w));
    assert.ok(!('updateAvailable' in w));
    assert.ok(!('restorable' in w));
    assert.ok(!('bundledVersion' in w));
    assert.ok(!('builder' in w));
  }
});

test('list_workflows inputs keep their enum but not the UI\'s label or options (#260: release.yaml pushed the list over MAX_CHARS)', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const list = JSON.parse((await callTool(tools, 'list_workflows', {})).text);
  for (const w of list) {
    for (const [name, input] of Object.entries(w.inputs || {})) {
      assert.ok(!('label' in input), `${w.file} input ${name} carries its label`);
      assert.ok(!('options' in input), `${w.file} input ${name} carries its options`);
    }
  }
  const release = list.find((w) => w.file === 'release.yaml');
  assert.deepEqual(release.inputs.e2e_suite.enum, ['run', 'skip']);
  assert.equal(release.inputs.e2e_suite.default, 'run');
});

test('callTool: list_runs answers isError false and its limit, projectId and status filters narrow the list', async (t) => {
  const { ctx, api } = makeCtx(t);
  const tools = supervisorTools(ctx);

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-tools-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = await api['projects:create']({ name: 'Runs project', folder });

  const { runId } = await api['run:start']({ file: 'fixture-supervisor-tools.yaml', inputs: {}, mock: true, projectId: project.id });
  await until(() => !api['runs:active']().some((r) => r.runId === runId));

  const all = await callTool(tools, 'list_runs', {});
  assert.equal(all.isError, false);
  const allRuns = JSON.parse(all.text);
  assert.ok(Array.isArray(allRuns.active));
  assert.ok(allRuns.runs.some((r) => r.runId === runId));

  const limited = JSON.parse((await callTool(tools, 'list_runs', { limit: 1 })).text);
  assert.equal(limited.runs.length, 1);

  const byProject = JSON.parse((await callTool(tools, 'list_runs', { projectId: project.id })).text);
  assert.deepEqual(byProject.runs.map((r) => r.runId), [runId]);
  assert.deepEqual(JSON.parse((await callTool(tools, 'list_runs', { projectId: 'nope' })).text).runs, []);

  const bySuccess = JSON.parse((await callTool(tools, 'list_runs', { status: 'success' })).text);
  assert.ok(bySuccess.runs.some((r) => r.runId === runId));
  assert.deepEqual(JSON.parse((await callTool(tools, 'list_runs', { status: 'failed' })).text).runs, []);
});

test('read_workflow: the YAML comes back with a "builder mode" header', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);
  const out = await callTool(tools, 'read_workflow', { file: 'fixture-supervisor-tools.yaml' });
  assert.equal(out.isError, false);
  assert.match(out.text, /^# fixture-supervisor-tools\.yaml \(builder mode: \w+\)\n\n/);
  assert.match(out.text, /name: fixture-supervisor-tools/);
});

test('read_workflow: a path like "../x" is reduced to its basename and cannot escape the workflows folder', async (t) => {
  const { ctx, service } = makeCtx(t);
  fs.writeFileSync(path.join(service.workspace().root, 'secret.txt'), 'TOP SECRET, outside workflows/');
  const tools = supervisorTools(ctx);
  const out = await callTool(tools, 'read_workflow', { file: '../secret.txt' });
  assert.equal(out.isError, true);
  assert.doesNotMatch(out.text, /TOP SECRET/);
});

test('callTool: run_report on an unknown run gives isError true', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);
  const out = await callTool(tools, 'run_report', { runId: 'does-not-exist' });
  assert.equal(out.isError, true);
});

test('callTool: an unknown tool name gives isError true', async (t) => {
  const { ctx } = makeCtx(t);
  const tools = supervisorTools(ctx);
  const out = await callTool(tools, 'no_such_tool', {});
  assert.equal(out.isError, true);
  assert.match(out.text, /Unknown tool: no_such_tool/);
});

test('callTool: output longer than MAX_CHARS is clipped with a "(clipped" note', async (t) => {
  const { ctx, service } = makeCtx(t);
  fs.writeFileSync(path.join(service.workspace().workflows, 'huge.yaml'), `# ${'x'.repeat(MAX_CHARS + 10000)}\n`);
  const tools = supervisorTools(ctx);
  const out = await callTool(tools, 'read_workflow', { file: 'huge.yaml' });
  assert.equal(out.isError, false);
  assert.ok(out.text.length < MAX_CHARS + 200);
  assert.match(out.text, /\(clipped/);
});

test('describeTools: the MCP tool list has a name, a description and an inputSchema, never the run function', () => {
  const tools = [{ name: 't', description: 'd', inputSchema: { type: 'object' }, run: () => 'x' }];
  const described = describeTools(tools);
  assert.deepEqual(described, [{ name: 't', description: 'd', inputSchema: { type: 'object' } }]);
  assert.ok(!('run' in described[0]));
});
