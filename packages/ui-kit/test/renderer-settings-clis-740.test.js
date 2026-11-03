// #740 (acceptance tests, written before the code): Settings › Agents & CLIs shows the first-run Setup's CLI
// rows (packages/ui-kit/setup.js: status, version, account, ▶ Install / ▶ Sign in) outside the Setup's modal,
// opened by a deep link, with a close button and no stepper; in the browser UI the actions run on the
// engine's machine as a job (cli-setup:start), whose output, device code and URL show in the panel.
//
// The contract assumed here:
// - window.Settings.open(section, { highlight, onClose }) (packages/ui-kit/views/settings/settings.js): shows
//   the Settings screen (state.view 'settings') on that section; 'agents' is Agents & CLIs. `highlight`: the id
//   of a CLI whose row is marked (data-highlight on its row); `onClose`: called when its close button is
//   pressed.
// - The section holds the rows in an element with data-testid="settings-clis" (the rows may be written
//   into an element with an id inside it or on it) and a close button data-testid="settings-clis-close";
//   no Setup stepper buttons (setup-next / setup-back / setup-skip).
// - Each row is setup.js's: data-testid="setup-cli-<id>", its status data-state="ready" | ..., its action
//   button data-testid="setup-install-<id>" / "setup-sign-in-<id>", enabled when canRunCommands()
//   (command-hint.js: in the browser, when api.cliSetupStart exists).
// - In the browser (api.platform 'browser'), an action calls api.cliSetupStart({ id, action }) with action
//   'install' | 'login' (never the terminal dock, api.termOpen); the panel follows api.onCliSetupChanged(job)
//   (job: { jobId, id, action, status, output, deviceCode?, url?, tool? }): a device code shows in an element
//   data-testid="cli-setup-device-code" and its URL as a link (href); when the job ends, the CLI's row is
//   checked again (api.envDetails or the job's `tool`).
// Harness: packages/ui-kit/test/renderer-app-harness.js (the real page in a vm with a fake DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');
const H = require('./page-pieces');
const clone = (x) => JSON.parse(JSON.stringify(x));

// (the kit's tests never require a front's helpers: these three follow fronts/analyser/test/project-page-helpers.js)
/** Every markup string the page holds now: what was written into an element or inserted, then the views' own markup. */
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
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
let clicks = 0;
/** Clicks a parsed element: its own #id element (or a fake one carrying its attributes), the elements holding its markup, the open screen's section, the document. */
async function clickRendered(app, el) {
  const sel = el.attrs.id ? `#${el.attrs.id}` : `[data-test-click-${(clicks += 1)}]`;
  const target = app.el(sel);
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('data-')) target.dataset[camel(k.slice(5))] = v;
    else if (k === 'class') target.className = v;
    else if (k !== 'id') target.attrs[k] = v;
  }
  target.tagName = el.name.toUpperCase();
  target.textContent = H.visibleText(el.inner);
  const holders = [];
  for (const [key, fake] of app.elements) {
    if (key === sel) continue;
    if (String(fake.innerHTML || '').includes(el.outer) || (fake.inserted || []).some(([, html]) => String(html).includes(el.outer))) holders.push(key);
  }
  const def = app.defs.get(app.state().view);
  await app.click(sel, { within: [...holders, `#view-${def?.section || app.state().view}`] });
  await app.settle(10);
}

// what env:details answers: gh missing, glab installed and signed out, git ready
const GH_MISSING = { id: 'gh', name: 'GitHub CLI', path: null, connected: false, installCommand: 'winget install --id GitHub.cli -e', signInCommand: 'gh auth login' };
const GH_READY = { id: 'gh', name: 'GitHub CLI', path: 'C:/bin/gh.exe', version: 'gh version 2.60.0', connected: true, auth: true, account: 'octocat', signInCommand: 'gh auth login' };
const GLAB_OUT = { id: 'glab', name: 'GitLab CLI', path: 'C:/bin/glab.exe', version: 'glab 1.46.1', connected: false, auth: true, signInCommand: 'glab auth login' };
const GIT = { id: 'git', name: 'Git', path: 'C:/bin/git.exe', version: 'git version 2.47.0', connected: true };

// The page in the browser UI (npm run serve) with an engine that offers the job; `tools` is read on each env:details
function browserPage(tools = { list: [GH_MISSING, GLAB_OUT, GIT] }, extra = {}) {
  return loadApp({
    api: {
      platform: 'browser',
      getSettings: async () => ({ setupDone: true }),
      envDetails: async () => clone(tools.list),
      cliSetupStart: async (data) => ({ jobId: 'job-1', id: data?.id, action: data?.action, status: 'running', output: '' }),
      ...extra,
    },
  });
}

// The markup of every element carrying data-testid="<testid>", with what was written into the ids on or inside it
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

const byTestId = (html, id) => H.findEl(html, (e) => e.attrs['data-testid'] === id);
const highlighted = (el) => 'data-highlight' in el.attrs || String(el.attrs.class || '').split(/\s+/).includes('highlight');

async function openClis(app, opts = {}) {
  await app.boot();
  // a confirmation before running a command (app.js confirmDialog) is accepted
  app.run('confirmDialog = async () => true;');
  assert.equal(typeof app.sandbox.Settings?.open, 'function', 'window.Settings.open (settings.js)');
  await app.sandbox.Settings.open('agents', opts);
  await app.settle(20);
}

test('#740 Settings › Agents & CLIs: the CLI rows with a close button and no Setup stepper', async () => {
  const app = browserPage();
  await openClis(app);
  assert.equal(app.state().view, 'settings');
  const html = region(app, 'settings-clis');
  assert.ok(byTestId(html, 'setup-cli-gh'), 'the gh row');
  assert.ok(byTestId(html, 'setup-cli-glab'), 'the glab row');
  assert.ok(byTestId(html, 'setup-cli-git'), 'the git row');
  assert.ok(H.visibleText(html).includes('git version 2.47.0'), 'a ready CLI shows its version');
  assert.ok(byTestId(pageMarkup(app), 'settings-clis-close'), 'a close button (data-testid="settings-clis-close")');
  for (const id of ['setup-next', 'setup-back', 'setup-skip']) assert.equal(byTestId(html, id), null, `no ${id} in the section`);
  assert.equal(app.sandbox.Setup.isOpen(), false, 'the first-run Setup is not opened');
});

test('#740 in the browser UI with the engine\'s job, ▶ Install of a missing CLI and ▶ Sign in are enabled', async () => {
  const app = browserPage();
  await openClis(app);
  const html = region(app, 'settings-clis');
  const install = byTestId(html, 'setup-install-gh');
  assert.ok(install, 'gh\'s ▶ Install');
  assert.equal('disabled' in install.attrs, false, 'Install is enabled');
  const signIn = byTestId(html, 'setup-sign-in-glab');
  assert.ok(signIn, 'glab\'s ▶ Sign in');
  assert.equal('disabled' in signIn.attrs, false, 'Sign in is enabled');
});

test('#740 the deep link marks the CLI it was opened for', async () => {
  const app = browserPage();
  await openClis(app, { highlight: 'gh' });
  const html = region(app, 'settings-clis');
  assert.equal(highlighted(byTestId(html, 'setup-cli-gh')), true, 'the gh row is highlighted');
  assert.equal(highlighted(byTestId(html, 'setup-cli-git')), false, 'the git row is not');
});

test('#740 the close button calls the deep link\'s onClose once', async () => {
  const app = browserPage();
  let closed = 0;
  await openClis(app, { highlight: 'gh', onClose: () => { closed += 1; } });
  const close = byTestId(pageMarkup(app), 'settings-clis-close');
  assert.ok(close, 'data-testid="settings-clis-close"');
  await clickRendered(app, close);
  assert.equal(closed, 1);
});

test('#740 in the browser ▶ Install runs on the engine (cli-setup:start), never in a terminal of the page', async () => {
  const app = browserPage();
  await openClis(app);
  const install = byTestId(region(app, 'settings-clis'), 'setup-install-gh');
  assert.ok(install, 'gh\'s ▶ Install');
  await clickRendered(app, install);
  await app.settle(10);
  const calls = app.callsTo('cliSetupStart').map(([arg]) => clone(arg ?? null));
  assert.deepEqual(calls, [{ id: 'gh', action: 'install' }]);
  assert.equal(app.callsTo('termOpen').length, 0, 'no terminal of the dock');
});

test('#740 a sign-in\'s device code and URL show in the panel, and the row is checked again when the job ends', async () => {
  const tools = { list: [GH_MISSING, GLAB_OUT, GIT] };
  const app = browserPage(tools);
  await openClis(app);
  const signIn = byTestId(region(app, 'settings-clis'), 'setup-sign-in-glab');
  assert.ok(signIn, 'glab\'s ▶ Sign in');
  await clickRendered(app, signIn);
  await app.settle(10);
  assert.deepEqual(app.callsTo('cliSetupStart').map(([arg]) => clone(arg ?? null)), [{ id: 'glab', action: 'login' }]);

  const push = async (job) => { for (const fn of app.apiHandlers.onCliSetupChanged || []) fn(clone(job)); await app.settle(10); };
  assert.ok((app.apiHandlers.onCliSetupChanged || []).length > 0, 'the panel follows api.onCliSetupChanged');
  await push({ jobId: 'job-1', id: 'glab', action: 'login', status: 'running', output: '! One-time code: WXYZ-9876\nOpen https://gitlab.com/oauth/device\n', deviceCode: 'WXYZ-9876', url: 'https://gitlab.com/oauth/device' });
  const page = pageMarkup(app);
  const code = byTestId(page, 'cli-setup-device-code');
  assert.ok(code, 'data-testid="cli-setup-device-code"');
  assert.ok(H.visibleText(code.inner).includes('WXYZ-9876'), 'the code');
  assert.ok(H.findEl(page, (e) => e.name === 'a' && e.attrs.href === 'https://gitlab.com/oauth/device'), 'the URL as a link');

  const glabIn = { ...GLAB_OUT, connected: true, account: 'tanuki' };
  tools.list = [GH_MISSING, glabIn, GIT];
  await push({ jobId: 'job-1', id: 'glab', action: 'login', status: 'done', output: 'Logged in as tanuki\n', tool: glabIn });
  const row = byTestId(region(app, 'settings-clis'), 'setup-cli-glab');
  const status = H.findEl(row.outer, (e) => 'data-state' in e.attrs);
  assert.equal(status?.attrs['data-state'], 'ready', 'the glab row is ready after the sign-in');
});

// guard (passes before #740 too): the desktop app keeps Settings' Agents & CLIs reachable
test('#740 guard: the Settings screen still has its Agents & CLIs tab', () => {
  const app = browserPage();
  const markup = String(app.defs.get('settings')?.markup || '');
  assert.ok(H.findEl(markup, (e) => e.attrs['data-stab'] === 'agents'), 'the agents tab');
});
