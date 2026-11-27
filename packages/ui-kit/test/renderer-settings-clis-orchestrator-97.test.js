// #97 (acceptance tests, written before the code): Settings › Agents & CLIs (packages/ui-kit/views/settings/settings-clis.js)
// shows the orchestrator AI choice of the first-run Setup: radios name="orchestrator", values claude and codex
// (data-testid="setup-orchestrator-<id>", as the Setup's), the saved settings.orchestratorProvider checked (claude
// when none is saved), no radio for Grok, a missing or signed-out CLI's radio disabled.
// Harness: renderer-app-harness.js (the real page in a vm with a fake DOM); markup read as strings (page-pieces.js),
// the section found as renderer-settings-clis-740.test.js finds it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');
const clone = (x) => JSON.parse(JSON.stringify(x));

function pageMarkup(app) {
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  for (const def of app.defs.values()) parts.push(String(def.markup || ''), String(def.modals || ''));
  return parts.join('\n');
}
const existing = (app, id) => app.created.find((e) => e.id === id) || app.elements.get(`#${id}`) || null;

// the markup of the element data-testid="<testid>", with what was written into the ids on or inside it
function region(app, testid) {
  const parts = [];
  const seen = new Set();
  const follow = (html, depth) => {
    parts.push(html);
    if (depth > 3) return;
    for (const m of String(html).matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const el = existing(app, m[1]);
      if (el) {
        if (el.innerHTML) follow(String(el.innerHTML), depth + 1);
        for (const [, html2] of el.inserted || []) follow(String(html2 || ''), depth + 1);
      }
    }
  };
  const direct = app.elements.get(`[data-testid="${testid}"]`);
  if (direct?.innerHTML) follow(String(direct.innerHTML), 0);
  for (const el of H.findAll(pageMarkup(app), (e) => e.attrs['data-testid'] === testid)) follow(el.outer, 0);
  return parts.join('\n');
}

const READY = (id, name) => ({ id, name, path: `C:/bin/${id}.exe`, version: '1.0.0', connected: true, auth: true });
const SIGNED_OUT = (id, name) => ({ id, name, path: `C:/bin/${id}.exe`, version: '1.0.0', connected: false, auth: true, signInCommand: `${id} login` });
const GIT = READY('git', 'Git');

async function openClis(tools, settings = {}) {
  const app = loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true, ...settings }),
      envDetails: async () => clone(tools),
      cliSetupStart: async (data) => ({ jobId: 'job-1', id: data?.id, action: data?.action, status: 'running', output: '' }),
    },
  });
  await app.boot();
  app.run('confirmDialog = async () => true;');
  await app.sandbox.Settings.open('agents');
  await app.settle(20);
  return app;
}

// one radio per value: the last markup copy of each (the section may be drawn twice while it checks)
function orchestratorRadios(html) {
  const byValue = new Map();
  for (const el of H.findAll(html, (e) => e.name === 'input' && e.attrs.type === 'radio' && e.attrs.name === 'orchestrator')) byValue.set(el.attrs.value, el);
  return byValue;
}

test('#97 Settings › Agents & CLIs: the orchestrator radios for Claude Code and Codex, none for Grok, the saved choice checked', async () => {
  const app = await openClis([READY('claude', 'Claude Code'), READY('codex', 'Codex CLI'), READY('grok', 'Grok Build'), GIT], { orchestratorProvider: 'codex' });
  const radios = orchestratorRadios(region(app, 'settings-clis'));
  assert.deepEqual([...radios.keys()].sort(), ['claude', 'codex'], 'radios valued claude and codex only (no grok)');
  assert.equal(radios.get('codex').attrs['data-testid'], 'setup-orchestrator-codex');
  assert.equal(radios.get('claude').attrs['data-testid'], 'setup-orchestrator-claude');
  assert.equal('checked' in radios.get('codex').attrs, true, 'the saved Codex is checked');
  assert.equal('checked' in radios.get('claude').attrs, false, 'Claude Code is not');
});

test('#97 Settings › Agents & CLIs: no saved choice checks Claude Code; a signed-out CLI\'s radio is disabled', async () => {
  const app = await openClis([READY('claude', 'Claude Code'), SIGNED_OUT('codex', 'Codex CLI'), GIT]);
  const radios = orchestratorRadios(region(app, 'settings-clis'));
  assert.ok(radios.get('claude') && radios.get('codex'), 'both orchestrator radios are drawn');
  assert.equal('checked' in radios.get('claude').attrs, true, 'Claude Code is checked');
  assert.equal('disabled' in radios.get('codex').attrs, true, 'the signed-out Codex radio is disabled');
});
