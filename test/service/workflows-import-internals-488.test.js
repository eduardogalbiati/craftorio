// #488 internals of the import (the review's findings): the confirmation of a url refuses a text that
// is no longer the one previewed, a redirect off https and an oversized body are refused, the name is
// trimmed and a name the file system refuses leaves no temporary file; requiresProblem is the one rule
// for the manifest and the import; summarize flattens nested tool lists and lists the steps' own tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');
const { requiresProblem, parseManifest } = require('../../src/domains/project/project-manifest');
const { summarize } = require('../../src/shared/workflow-compose');

const FLOW = `apiVersion: multiagent/v1
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
const OTHER = FLOW.replace('"tidy up"', '"something else"');

const dir = (service) => service.workspace().workflows;
const leftovers = (service) => fs.readdirSync(dir(service)).filter((f) => f.startsWith('.import-'));

function stubFetch(t, respond) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return respond(calls.length); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test('#488 a url confirmed with the preview\'s fingerprint is refused when it now answers another text', async (t) => {
  const { api, service } = makeService(t);
  stubFetch(t, (n) => new Response(n === 1 ? FLOW : OTHER));
  const url = 'https://workflows.invalid/flow.yaml';
  const preview = await api['workflows:import']({ url, preview: true });
  assert.equal(typeof preview.fingerprint, 'string');
  await assert.rejects(api['workflows:import']({ url, name: 'swapped', fingerprint: preview.fingerprint }), /changed since the preview/);
  assert.equal(fs.existsSync(path.join(dir(service), 'swapped.yaml')), false);
});

test('#488 a url confirmed with the same text as the preview is written', async (t) => {
  const { api, service } = makeService(t);
  const calls = stubFetch(t, () => new Response(FLOW));
  const url = 'https://workflows.invalid/flow.yaml';
  const { fingerprint } = await api['workflows:import']({ url, preview: true });
  await api['workflows:import']({ url, name: 'same', fingerprint });
  assert.equal(fs.readFileSync(path.join(dir(service), 'same.yaml'), 'utf8'), FLOW);
  assert.equal(calls[0].opts.redirect, 'error', 'no redirect is followed');
});

test('#488 a response that ended on http (a redirect) is refused', async (t) => {
  const { api } = makeService(t);
  stubFetch(t, () => {
    const res = new Response(FLOW);
    Object.defineProperty(res, 'url', { value: 'http://workflows.invalid/flow.yaml' });
    return res;
  });
  await assert.rejects(api['workflows:import']({ url: 'https://workflows.invalid/flow.yaml', name: 'redirected' }), /https/);
});

test('#488 a body over the cap is refused, by its content-length or while reading', async (t) => {
  const { api } = makeService(t);
  const big = 'x'.repeat(1024 * 1024 + 1);
  stubFetch(t, (n) => (n === 1 ? new Response('x', { headers: { 'content-length': String(big.length) } }) : new Response(big)));
  await assert.rejects(api['workflows:import']({ url: 'https://workflows.invalid/a.yaml', name: 'a' }), /too large/);
  await assert.rejects(api['workflows:import']({ url: 'https://workflows.invalid/b.yaml', name: 'b' }), /too large/);
});

test('#488 the name is trimmed, and a name the file system refuses leaves no temporary file', async (t) => {
  const { api, service } = makeService(t);
  const r = await api['workflows:import']({ text: FLOW, name: ' spaced ' });
  assert.equal(r.file, 'spaced.yaml');
  assert.equal(fs.existsSync(path.join(dir(service), 'spaced.yaml')), true);
  await assert.rejects(api['workflows:import']({ text: FLOW, name: 'a:b*c' }), /Not a workflow name/);
  assert.deepEqual(leftovers(service), []);
});

test('#488 requiresProblem: null when absent or satisfied, the reason otherwise, the manifest\'s too', () => {
  assert.equal(requiresProblem('1.2.0', null), null);
  assert.equal(requiresProblem('1.2.0', '>=1.0'), null);
  assert.match(requiresProblem('1.2.0', '>=9.0'), /requires app version >=9.0, this app is 1.2.0/);
  assert.match(requiresProblem('1.2.0', 'soon'), /not a version range/);
  const { errors } = parseManifest('requires: ">=9.0"\n', { appVersion: '1.2.0' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\.multiagent\/project\.yaml: requires app version >=9\.0, this app is 1\.2\.0\.$/);
});

test('#488 summarize flattens nested tool lists and lists the steps\' own tools', () => {
  const s = summarize({
    agents: { writer: { capabilities: { tools: [['read', 'edit'], 'bash:git'] } } },
    steps: [{ id: 'build', capabilities: { tools: ['bash:npm', ['write']] } }, { id: 'plain' }],
  });
  assert.deepEqual(s.agents, [{ name: 'writer', tools: ['read', 'edit', 'bash:git'] }]);
  assert.deepEqual(s.stepTools, [{ step: 'build', tools: ['bash:npm', 'write'] }]);
  assert.deepEqual(s.tools, ['read', 'edit', 'bash:git', 'bash:npm', 'write']);
});
