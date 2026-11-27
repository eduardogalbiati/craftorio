// #97 (acceptance tests, written before the code): the first-run Setup's AIs step (packages/ui-kit/setup.js, cliCard)
// lets the owner choose the orchestrator AI: Claude Code or Codex (never Grok), saved as settings.orchestratorProvider.
//
// Contract assumed:
// - the Claude Code and Codex cards (data-testid="setup-cli-claude" / "setup-cli-codex") each hold a radio
//   <input type="radio" name="orchestrator" value="<id>" data-testid="setup-orchestrator-<id>"> ("Use as
//   orchestrator", i18n key setup.use_as_orchestrator); the Grok card has none; exactly one is checked;
// - a missing or signed-out CLI's radio is disabled;
// - the checked one: settings.orchestratorProvider when saved, else, when only one of the two is ready, that one,
//   else claude;
// - the chosen card's badge reads "Required", the other AI cards' "Optional";
// - choosing a radio saves settings.orchestratorProvider (api.setSettings);
// - the note of what will not run (data-testid="setup-missing-note") names the chosen AI when it is not ready.
// Driven on the real page (renderer-app-harness.js); markup is read as strings (page-pieces.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');

const READY = (id, name) => ({ id, name, path: `/usr/bin/${id}`, version: '1.0.0', connected: true, auth: true });
const MISSING = (id, name) => ({ id, name, path: null, connected: false, installCommand: `npm install -g ${id}` });
const SIGNED_OUT = (id, name) => ({ id, name, path: `/usr/bin/${id}`, version: '1.0.0', connected: false, auth: true, signInCommand: `${id} login` });
const OTHERS = [READY('gh', 'GitHub CLI'), READY('git', 'Git'), READY('gitleaks', 'gitleaks')];

async function openSetup({ claude, codex, grok = MISSING('grok', 'Grok Build'), settings = {}, workflows = [] }) {
  let saved = { setupDone: true, ...settings };
  const app = loadApp({
    api: {
      getSettings: async () => JSON.parse(JSON.stringify(saved)),
      setSettings: async (patch) => { saved = { ...saved, ...JSON.parse(JSON.stringify(patch || {})) }; return JSON.parse(JSON.stringify(saved)); },
      listWorkflows: async () => JSON.parse(JSON.stringify(workflows)),
      listProjects: async () => [],
      envDetails: async () => JSON.parse(JSON.stringify([claude, codex, grok, ...OTHERS])),
      machineProfile: async () => ({ line: '8 cores' }),
    },
  });
  await app.boot();
  app.run('confirmDialog = async () => true;');
  await app.run('window.Setup.open("agents")');
  await app.settle(20);
  assert.equal(app.run('window.Setup.isOpen()'), true, 'the Setup is open');
  return app;
}

const body = (app) => String(app.el('#setup-modal #setup-body').innerHTML || '');
const card = (app, id) => {
  const el = H.findEl(body(app), (e) => e.attrs['data-testid'] === `setup-cli-${id}`);
  assert.ok(el, `the ${id} card is drawn`);
  return el.outer;
};
const radios = (html) => H.findAll(html, (e) => e.name === 'input' && e.attrs.type === 'radio' && e.attrs.name === 'orchestrator');
const radioOf = (app, id) => {
  const list = radios(card(app, id));
  assert.equal(list.length, 1, `one orchestrator radio in the ${id} card`);
  assert.equal(list[0].attrs['data-testid'], `setup-orchestrator-${id}`, `the ${id} radio's testid`);
  return list[0];
};
const isChecked = (el) => 'checked' in el.attrs;
const isDisabled = (el) => 'disabled' in el.attrs;
const badgeOf = (app, id) => {
  const el = H.findEl(card(app, id), (e) => e.name === 'span' && String(e.attrs.class || '').split(/\s+/).includes('badge'));
  assert.ok(el, `the ${id} card's badge`);
  return H.visibleText(el.inner).trim();
};

test('#97 Setup: Claude Code and Codex cards have an orchestrator radio (one group, one checked), Grok has none', { timeout: 30000 }, async () => {
  const app = await openSetup({ claude: READY('claude', 'Claude Code'), codex: READY('codex', 'Codex CLI'), grok: READY('grok', 'Grok Build') });
  assert.equal(radios(body(app)).length, 2, 'two orchestrator radios on the AIs step');
  radioOf(app, 'claude');
  radioOf(app, 'codex');
  assert.equal(radios(card(app, 'grok')).length, 0, 'no orchestrator radio in the Grok card');
  assert.equal(radios(body(app)).filter(isChecked).length, 1, 'exactly one radio checked');
  assert.equal(isChecked(radioOf(app, 'claude')), true, 'both ready and nothing saved: Claude Code is chosen');
});

test('#97 Setup: a missing or signed-out CLI\'s orchestrator radio is disabled', { timeout: 30000 }, async () => {
  const missing = await openSetup({ claude: READY('claude', 'Claude Code'), codex: MISSING('codex', 'Codex CLI') });
  assert.equal(isDisabled(radioOf(missing, 'codex')), true, 'missing Codex: its radio is disabled');
  assert.equal(isDisabled(radioOf(missing, 'claude')), false, 'ready Claude Code: its radio is enabled');
  const signedOut = await openSetup({ claude: SIGNED_OUT('claude', 'Claude Code'), codex: READY('codex', 'Codex CLI') });
  assert.equal(isDisabled(radioOf(signedOut, 'claude')), true, 'signed-out Claude Code: its radio is disabled');
  assert.equal(isDisabled(radioOf(signedOut, 'codex')), false, 'ready Codex: its radio is enabled');
});

test('#97 Setup: with only Codex ready, Codex is chosen by default, its card Required and Claude Code\'s Optional', { timeout: 30000 }, async () => {
  const app = await openSetup({ claude: MISSING('claude', 'Claude Code'), codex: READY('codex', 'Codex CLI') });
  assert.equal(isChecked(radioOf(app, 'codex')), true, 'Codex is chosen');
  assert.equal(isChecked(radioOf(app, 'claude')), false, 'Claude Code is not');
  assert.equal(badgeOf(app, 'codex'), 'Required');
  assert.equal(badgeOf(app, 'claude'), 'Optional');
});

test('#97 Setup: with only Claude Code ready, Claude Code is chosen by default and Required, Codex Optional', { timeout: 30000 }, async () => {
  const app = await openSetup({ claude: READY('claude', 'Claude Code'), codex: SIGNED_OUT('codex', 'Codex CLI') });
  assert.equal(isChecked(radioOf(app, 'claude')), true, 'Claude Code is chosen');
  assert.equal(badgeOf(app, 'claude'), 'Required');
  assert.equal(badgeOf(app, 'codex'), 'Optional');
});

test('#97 Setup: a saved orchestratorProvider codex is the checked radio, Codex Required and Claude Code Optional', { timeout: 30000 }, async () => {
  const app = await openSetup({ claude: READY('claude', 'Claude Code'), codex: READY('codex', 'Codex CLI'), settings: { orchestratorProvider: 'codex' } });
  assert.equal(isChecked(radioOf(app, 'codex')), true, 'Codex is checked');
  assert.equal(isChecked(radioOf(app, 'claude')), false, 'Claude Code is not');
  assert.equal(badgeOf(app, 'codex'), 'Required');
  assert.equal(badgeOf(app, 'claude'), 'Optional');
});

test('#97 Setup: choosing the Codex radio saves settings.orchestratorProvider codex', { timeout: 30000 }, async () => {
  const app = await openSetup({ claude: READY('claude', 'Claude Code'), codex: READY('codex', 'Codex CLI') });
  const sel = '[data-testid="setup-orchestrator-codex"]';
  const target = app.el(sel);
  Object.assign(target, { tagName: 'INPUT', type: 'radio', name: 'orchestrator', value: 'codex', checked: true });
  Object.assign(target.attrs, { type: 'radio', name: 'orchestrator', value: 'codex', 'data-testid': 'setup-orchestrator-codex' });
  target.dataset.testid = 'setup-orchestrator-codex';
  await app.click(sel, { within: ['#setup-modal #setup-body', '#setup-modal'] });
  const savedCodex = () => app.callsTo('setSettings').some(([patch]) => patch?.orchestratorProvider === 'codex');
  if (!savedCodex()) {
    // a change listener instead of a click one: the same radio's change event, on its holders
    const ev = { type: 'change', target, currentTarget: target, stopPropagation() {}, preventDefault() {} };
    for (const node of [target, app.el('#setup-modal #setup-body'), app.el('#setup-modal')]) {
      ev.currentTarget = node;
      for (const fn of node.listeners.change || []) await fn(ev);
    }
    app.run('document').dispatchEvent(ev);
    await app.settle(10);
  }
  assert.equal(savedCodex(), true, `setSettings calls: ${JSON.stringify(app.callsTo('setSettings'))}`);
});

test('#97 Setup: with Codex chosen and not ready, the missing note names Codex CLI, not Claude Code', { timeout: 30000 }, async () => {
  const workflows = [{ file: 'fix.yaml', name: 'fix', origin: 'bundled', category: 'build', requirements: { clis: ['codex', 'git'], forge: false } }];
  const app = await openSetup({ claude: MISSING('claude', 'Claude Code'), codex: SIGNED_OUT('codex', 'Codex CLI'), settings: { orchestratorProvider: 'codex' }, workflows });
  const note = H.findEl(body(app), (e) => e.attrs['data-testid'] === 'setup-missing-note');
  assert.ok(note, 'the note of what will not run is drawn');
  const shown = H.visibleText(note.inner);
  assert.ok(shown.includes('Codex CLI'), `the chosen AI is named in: ${shown}`);
  assert.equal(shown.includes('Claude Code'), false, `Claude Code is optional, not named in: ${shown}`);
});
