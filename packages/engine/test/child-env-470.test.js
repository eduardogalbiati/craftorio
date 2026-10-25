// #470 (SEC-5): agents and project commands get an environment built from an allowlist, not the
// whole parent environment. PATH, the temp folders, GIT_*, the engine's own AGENT_ENV pass; GH_* /
// GITHUB_TOKEN only for an agent with bash:gh, GITLAB_* only with bash:glab; a workflow's
// `env: { passthrough: [...] }` adds named variables. The recorded `spawn` event names the keys,
// never the values. `printenv` is no longer an allowed read utility (`env` and `set` neither).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
const upper = (keys) => keys.map((k) => k.toUpperCase());

// What a developer's machine holds and no agent or project command needs
const SECRETS = {
  AWS_SECRET_ACCESS_KEY: 'aws-secret-value-470',
  AWS_ACCESS_KEY_ID: 'aws-key-id-value-470',
  ANTHROPIC_API_KEY: 'anthropic-value-470',
  OPENAI_API_KEY: 'openai-value-470',
  SSH_AUTH_SOCK: 'ssh-sock-value-470',
  NPM_TOKEN: 'npm-token-value-470',
  SOME_UNLISTED_VAR_470: 'unlisted-value-470',
};
// Platform tokens: only for the agent whose toolchain is that platform's CLI
const PLATFORM = {
  GITHUB_TOKEN: 'github-token-value-470',
  GH_TOKEN: 'gh-token-value-470',
  GITLAB_TOKEN: 'gitlab-token-value-470',
};
// An allowlisted family (GIT_*) and a variable a workflow passes through on purpose
const ALLOWED = { GIT_MARKER_470: 'git-marker-value-470', LANG: 'en_US.UTF-8' };
const PASSTHROUGH = { MY_PROJECT_VAR_470: 'project-var-value-470' };

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

// One real turn of a fake Claude CLI (no model) that answers with the names of its env variables.
async function agentTurn(t, { tools, top = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'child-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // the "CLI" is node + a fake that calls no model: lift the simulation-only guard for this test
  const outer = {
    MULTIAGENT_SIMULATION_ONLY: process.env.MULTIAGENT_SIMULATION_ONLY,
    MULTIAGENT_WORKSPACE: process.env.MULTIAGENT_WORKSPACE,
    MULTIAGENT_USER_DATA: process.env.MULTIAGENT_USER_DATA,
  };
  for (const k of Object.keys(outer)) delete process.env[k];
  t.after(() => { for (const [k, v] of Object.entries(outer)) { if (v !== undefined) process.env[k] = v; } });
  withEnv(t, { ...SECRETS, ...PLATFORM, ...ALLOWED, ...PASSTHROUGH });

  const { WorkflowRun } = require('../engine/workflow');
  const fake = path.join(__dirname, 'fixtures', 'fake-claude-env.js').replace(/\\/g, '/');
  const file = path.join(dir, 'wf.yaml');
  fs.writeFileSync(file, [
    ...top,
    'providers:',
    `  claude: { type: claude-code, command: node, args: ["${fake}", "-p"] }`,
    'agents:',
    `  dev: { provider: claude, model: fake, session: handoff, capabilities: { tools: [${tools.join(', ')}] } }`,
    'steps:',
    '  - { id: work, agent: dev, prompt: "Do it." }',
  ].join('\n'));
  const run = new WorkflowRun({ file, inputs: {}, runsDir: path.join(dir, 'runs') });
  const events = [];
  run.on('event', (ev) => events.push(ev));
  await run.start();
  const finished = events.find((e) => e.type === 'workflow.finished');
  assert.equal(finished.status, 'success', finished.error);
  const received = events.find((e) => e.type === 'session.message_received');
  const m = /env keys: (\[.*\])/.exec(received.text);
  assert.ok(m, received.text);
  const spawn = events.find((e) => e.type === 'session.stream' && e.item.kind === 'spawn').item;
  return { keys: upper(JSON.parse(m[1])), spawn };
}

test('an agent with bash:git gets PATH, GIT_*, LANG and the engine\'s AGENT_ENV, and none of the parent\'s secrets or platform tokens', { timeout: 60000 }, async (t) => {
  const { keys } = await agentTurn(t, { tools: ['read', 'bash:git'] });
  assert.ok(keys.includes('PATH'), keys.join(','));
  assert.ok(keys.includes('GIT_MARKER_470'), 'GIT_* is allowlisted');
  assert.ok(keys.includes('LANG'), 'LANG is allowlisted');
  assert.ok(keys.includes('MULTIAGENT_SIMULATION_ONLY'), 'the engine\'s AGENT_ENV still reaches the agent');
  for (const k of [...Object.keys(SECRETS), ...Object.keys(PLATFORM), ...Object.keys(PASSTHROUGH)]) {
    assert.ok(!keys.includes(k), `${k} must not reach an agent with bash:git`);
  }
});

test('GH_* and GITHUB_TOKEN reach only an agent with bash:gh; GITLAB_* stays out', { timeout: 60000 }, async (t) => {
  const { keys } = await agentTurn(t, { tools: ['read', 'bash:gh'] });
  assert.ok(keys.includes('GITHUB_TOKEN'), keys.join(','));
  assert.ok(keys.includes('GH_TOKEN'), keys.join(','));
  assert.ok(!keys.includes('GITLAB_TOKEN'));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), `${k} must not reach an agent with bash:gh`);
});

test('GITLAB_* reaches only an agent with bash:glab; GH_* and GITHUB_TOKEN stay out', { timeout: 60000 }, async (t) => {
  const { keys } = await agentTurn(t, { tools: ['read', 'bash:glab'] });
  assert.ok(keys.includes('GITLAB_TOKEN'), keys.join(','));
  assert.ok(!keys.includes('GITHUB_TOKEN'));
  assert.ok(!keys.includes('GH_TOKEN'));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), `${k} must not reach an agent with bash:glab`);
});

test('a workflow\'s env.passthrough adds the variables it names, and only those', { timeout: 60000 }, async (t) => {
  const { keys } = await agentTurn(t, { tools: ['read', 'bash:npm'], top: ['env:', '  passthrough: [MY_PROJECT_VAR_470]'] });
  assert.ok(keys.includes('MY_PROJECT_VAR_470'), keys.join(','));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), `${k} is not in the passthrough list`);
});

test('the recorded spawn event names the env\'s keys, never their values', { timeout: 60000 }, async (t) => {
  const { spawn } = await agentTurn(t, { tools: ['read', 'bash:gh'] });
  const recorded = JSON.stringify(spawn);
  assert.ok(recorded.includes('"GIT_MARKER_470"'), 'the keys passed to the agent are recorded');
  assert.ok(recorded.includes('"GITHUB_TOKEN"'), 'the keys passed to the agent are recorded');
  for (const v of [...Object.values(ALLOWED), ...Object.values(PLATFORM), ...Object.values(SECRETS)]) {
    assert.ok(!recorded.includes(v), `a value is recorded: ${v}`);
  }
  assert.ok(!recorded.includes('"AWS_SECRET_ACCESS_KEY"'), 'a key that is not passed is not recorded either');
});

test('a machine action (a transition\'s command) runs with the allowlisted env, not the whole parent env', { timeout: 60000 }, async (t) => {
  withEnv(t, { ...SECRETS, ...PLATFORM, ...ALLOWED });
  const { real } = require('../engine/machine-actions');
  const script = path.join(__dirname, 'fixtures', 'print-env-keys.js');
  const res = await real().runAction(`node "${script}"`, { cwd: __dirname });
  assert.equal(res.exit_code, 0, res.output);
  const keys = upper(JSON.parse(res.stdout));
  assert.ok(keys.includes('PATH'), keys.join(','));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), `${k} must not reach a machine action`);
});

test('the suite step\'s env (the repository\'s npm test) keeps PATH and the temp folders and drops the parent\'s secrets', () => {
  const { suiteEnv } = require('../engine/suite-step');
  const parent = { PATH: '/usr/bin', TMP: '/tmp/x', TEMP: '/tmp/x', LANG: 'en_US.UTF-8', GIT_MARKER_470: 'g', ...SECRETS, ...PLATFORM };
  const { env } = suiteEnv(parent, {});
  const keys = upper(Object.keys(env));
  assert.ok(keys.includes('PATH'), keys.join(','));
  assert.ok(keys.includes('LANG'), keys.join(','));
  assert.ok(keys.includes('GIT_MARKER_470'), keys.join(','));
  for (const k of [...Object.keys(SECRETS), ...Object.keys(PLATFORM)]) assert.ok(!keys.includes(k), `${k} must not reach the repository's tests`);
});

test('the terminals\' env (cliEnv) keeps PATH and drops the parent\'s secrets', (t) => {
  withEnv(t, { ...SECRETS, ...ALLOWED });
  const { cliEnv } = require('../service/common');
  const keys = upper(Object.keys(cliEnv()));
  assert.ok(keys.includes('PATH'), keys.join(','));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), `${k} must not reach a terminal`);
});

test('the suite step\'s env adds the workflow\'s env.passthrough names, and only those', () => {
  const { suiteEnv } = require('../engine/suite-step');
  const parent = { PATH: '/usr/bin', DATABASE_URL: 'postgres://x', OTHER_DB_URL: 'y', ...SECRETS };
  const keys = upper(Object.keys(suiteEnv(parent, { passthrough: ['DATABASE_URL'] }).env));
  assert.ok(keys.includes('DATABASE_URL'), keys.join(','));
  assert.ok(!keys.includes('OTHER_DB_URL'));
  for (const k of Object.keys(SECRETS)) assert.ok(!keys.includes(k), k);
  assert.ok(!upper(Object.keys(suiteEnv(parent, {}).env)).includes('DATABASE_URL'), 'not passed without the list');
});

test('childEnv passes the toolchain homes the language skills need (folders, not secrets)', () => {
  const { childEnv } = require('../engine/child-env');
  const homes = ['JAVA_HOME', 'M2_HOME', 'MAVEN_HOME', 'GRADLE_USER_HOME', 'GOPATH', 'GOROOT', 'GOFLAGS', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'VIRTUAL_ENV', 'PYTHONPATH', 'CARGO_HOME', 'RUSTUP_HOME'];
  const parent = Object.fromEntries([...homes.map((k) => [k, `/opt/${k}`]), ...Object.entries(SECRETS)]);
  const env = childEnv(parent);
  assert.deepEqual(Object.keys(env).sort(), [...homes].sort());
  assert.equal(env.JAVA_HOME, '/opt/JAVA_HOME', 'values unchanged');
});

test('childEnv keeps a key\'s own spelling (Windows\' Path) and matches names case-insensitively; platform tokens only on request', () => {
  const { childEnv } = require('../engine/child-env');
  const parent = { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', lc_all: 'C', GITHUB_TOKEN: 't', GH_HOST: 'h', GITLAB_TOKEN: 'g', Database_Url: 'd' };
  assert.deepEqual(Object.keys(childEnv(parent)).sort(), ['Path', 'SystemRoot', 'lc_all'].sort());
  assert.deepEqual(Object.keys(childEnv(parent, { platforms: ['gh'] })).sort(), ['GH_HOST', 'GITHUB_TOKEN', 'Path', 'SystemRoot', 'lc_all'].sort());
  assert.deepEqual(Object.keys(childEnv(parent, { platforms: ['glab'], passthrough: ['DATABASE_URL'] })).sort(), ['Database_Url', 'GITLAB_TOKEN', 'Path', 'SystemRoot', 'lc_all'].sort());
});

test('platformsOf: gh with bash:gh, glab with bash:glab, both with a bare bash or no capabilities, none otherwise', () => {
  const caps = require('../engine/capabilities');
  assert.deepEqual(caps.platformsOf(null), ['gh', 'glab']);
  assert.deepEqual(caps.platformsOf(caps.normalize({ tools: ['read', 'bash'] })), ['gh', 'glab']);
  assert.deepEqual(caps.platformsOf(caps.normalize({ tools: ['read', 'bash:gh'] })), ['gh']);
  assert.deepEqual(caps.platformsOf(caps.normalize({ tools: ['read', 'bash:glab', 'bash:git'] })), ['glab']);
  assert.deepEqual(caps.platformsOf(caps.normalize({ tools: ['read', 'bash:git', 'bash:npm'] })), []);
  assert.deepEqual(caps.platformsOf(caps.normalize({ tools: ['read'] })), []);
});

test('the workflow loader takes env.passthrough as a list of variable names and refuses anything else', (t) => {
  const { loadWorkflow } = require('../engine/workflow');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passthrough-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const load = (value) => {
    const f = path.join(dir, `wf-${Math.random().toString(36).slice(2)}.yaml`);
    fs.writeFileSync(f, `env:\n  passthrough: ${value}\nagents:\n  a: { provider: claude, model: m }\nsteps:\n  - { id: s, agent: a, prompt: x }\n`);
    return () => loadWorkflow(f);
  };
  assert.doesNotThrow(load('[DATABASE_URL]'));
  assert.doesNotThrow(load('[DATABASE_URL, _PRIVATE_1]'));
  assert.throws(load('["not a name!"]'), /env\.passthrough/);
  assert.throws(load('["AWS_*"]'), /env\.passthrough/);
  assert.throws(load('[]'), /env\.passthrough/);
});

// The check and screenshot steps run the repository's commands: the run state seam of
// test/engine-step-log-465.test.js (WorkflowRun.prototype on a small state)
function stepState(t, worktree, machine = {}) {
  const { WorkflowRun } = require('../engine/workflow');
  const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'child-env-run-')), 'runs', 'run-470');
  fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
  t.after(() => fs.rmSync(path.dirname(path.dirname(runDir)), { recursive: true, force: true, maxRetries: 3 }));
  const events = [];
  const state = Object.create(WorkflowRun.prototype);
  Object.assign(state, {
    mock: false, mockSequences: {}, machine: { simulated: false, ...machine }, runDir, runId: 'run-470',
    worktree: null, ctx: { worktree_dir: worktree, steps: {} }, abort: new AbortController(),
    wf: { env: { passthrough: ['MY_PROJECT_VAR_470'] } },
    watchMemory: () => ({ stop() {} }), emitEvent: (type, data) => events.push({ type, ...data }),
  });
  return { state, events };
}

test('a check step runs the repository\'s command with the allowlisted env plus the passthrough, never the secrets', { timeout: 60000 }, async (t) => {
  withEnv(t, { ...SECRETS, ...PLATFORM, ...PASSTHROUGH });
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'child-env-check-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'p' }));
  fs.writeFileSync(path.join(repo, 'keys.js'), "require('fs').writeFileSync('keys.json', JSON.stringify(Object.keys(process.env))); console.log('checks: pass');\n");
  const { state } = stepState(t, repo);
  const out = await state.runCheckStep({ id: 'rule_check', type: 'check', command: 'node keys.js' }, { visits: 1 });
  assert.equal(out.status, 'pass', out.message);
  const keys = upper(JSON.parse(fs.readFileSync(path.join(repo, 'keys.json'), 'utf8')));
  assert.ok(keys.includes('PATH'), keys.join(','));
  assert.ok(keys.includes('MY_PROJECT_VAR_470'), 'the workflow\'s passthrough');
  for (const k of [...Object.keys(SECRETS), ...Object.keys(PLATFORM)]) assert.ok(!keys.includes(k), `${k} must not reach a check step`);
});

test('a screenshots step hands the repository\'s capture command the allowlisted env, never the secrets', async (t) => {
  withEnv(t, { ...SECRETS, ...PLATFORM, ...PASSTHROUGH });
  let env = null;
  const { state } = stepState(t, os.tmpdir(), { captureScreenshots: async (opts) => { env = opts.env; return { status: 'skipped', screenshots: [], reason: 'stub' }; } });
  await state.runScreenshots({ id: 'screens', type: 'screenshots', from: 'dev' }, { visits: 1 });
  assert.ok(env, 'the capture was called with an env');
  const keys = upper(Object.keys(env));
  assert.ok(keys.includes('PATH'), keys.join(','));
  assert.ok(keys.includes('MY_PROJECT_VAR_470'), 'the workflow\'s passthrough');
  for (const k of [...Object.keys(SECRETS), ...Object.keys(PLATFORM)]) assert.ok(!keys.includes(k), `${k} must not reach a screenshot command`);
});

test('printenv is no longer an allowed read utility; env and set are not added', () => {
  const caps = require('../engine/capabilities');
  for (const u of ['printenv', 'env', 'set']) assert.ok(!caps.READ_UTILITIES.includes(u), u);
  const { args } = caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:git'] }) });
  const allowed = argAfter(args, '--allowedTools');
  assert.ok(!/printenv/.test(allowed), allowed);
  assert.ok(!/Bash\((env|set):/.test(allowed), allowed);
  const writer = argAfter(caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'write', 'bash:gh'] }) }).args, '--allowedTools');
  assert.ok(!/printenv/.test(writer), writer);
});
