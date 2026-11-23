// #30: the Next steps card of a freshly imported project offers the dependency install while the
// onboarding records them as not installed (api.onboardingStatus(<project>).deps: { status, command,
// reason }): the entry next-step-install-deps shows the exact command, waits disabled while installing,
// says why an install failed, and leaves once they are installed. On the real page
// (renderer-app-harness), as project-next-steps-onboarding-22.test.js drives it.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { pageMarkup, clickRendered } = require('./project-page-helpers');

const PID = 'p1';
const BASE = { id: PID, name: 'Widgets', repo: 'https://github.com/o/widgets.git', folder: '/ws/repos/widgets', exists: true, workflows: [{ name: 'feature', category: 'build', variant: 'local-code' }] };
const clone = (x) => JSON.parse(JSON.stringify(x));

async function projectPage({ status = async () => null, install = async () => null, lang = 'en' } = {}) {
  const calls = [];
  const app = loadApp({
    api: {
      listProjects: async () => [clone(BASE)],
      onboardingStatus: status,
      installOnboardingDeps: async (id) => { calls.push(id); return install(id); },
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }) },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return { app, calls };
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entry = (app) => H.findEl(card(app)?.outer || '', (e) => e.name === 'li' && e.attrs['data-testid'] === 'next-step-install-deps');
const button = (el) => H.findEl(el?.outer || '', (e) => e.name === 'button');
const deps = (d) => async () => ({ deps: d });

test('#30 dependencies missing: the entry offers the exact command with an enabled button', { timeout: 30000 }, async () => {
  const { app } = await projectPage({ status: deps({ status: 'missing', lockfile: 'package-lock.json', command: 'npm ci --ignore-scripts' }) });
  const el = entry(app);
  assert.equal(el === null, false, 'next-step-install-deps is shown');
  // the command is in a <code> element, which H.visibleText leaves out: the entry's text with its tags dropped
  const text = String(el.inner).replace(/<[^>]*>/g, ' ');
  assert.equal(text.includes('npm ci --ignore-scripts'), true, text);
  const b = button(el);
  assert.equal(b === null, false, 'the entry has a button');
  assert.equal('disabled' in b.attrs, false, 'its button is enabled');
});

test('#30 dependencies being installed: the entry\'s button waits, disabled', { timeout: 30000 }, async () => {
  const { app } = await projectPage({ status: deps({ status: 'installing', command: 'npm ci' }) });
  const b = button(entry(app));
  assert.equal(b === null, false, 'the entry is still shown, with its button');
  assert.equal('disabled' in b.attrs, true, 'disabled while installing');
});

test('#30 a failed install: the entry stays and says why', { timeout: 30000 }, async () => {
  const { app } = await projectPage({ status: deps({ status: 'failed', command: 'npm ci', reason: 'npm ERR! code ERESOLVE' }) });
  const el = entry(app);
  assert.equal(el === null, false, 'the entry is shown');
  assert.equal(H.visibleText(el.inner).includes('npm ERR! code ERESOLVE'), true, H.visibleText(el.inner));
  assert.equal('disabled' in button(el).attrs, false, 'it can be tried again');
});

for (const [name, status] of [
  ['installed dependencies', deps({ status: 'installed', command: 'npm ci' })],
  ['no dependency record (no lockfile)', async () => ({})],
  ['an onboarding status that cannot be read', async () => { throw new Error('no onboarding state'); }],
]) {
  test(`#30 ${name}: no install entry in the card`, { timeout: 30000 }, async () => {
    const { app } = await projectPage({ status });
    assert.equal(card(app) === null, false, 'the Next steps card is shown');
    assert.equal(entry(app) === null, true, 'no next-step-install-deps');
  });
}

test('#30 clicking install runs it for this project, then the entry leaves once installed', { timeout: 30000 }, async () => {
  const { app, calls } = await projectPage({
    status: deps({ status: 'missing', command: 'npm ci' }),
    install: async () => ({ deps: { status: 'installed', command: 'npm ci' } }),
  });
  await clickRendered(app, button(entry(app)));
  await app.settle(20);
  assert.deepEqual(calls, [PID]);
  assert.equal(entry(app) === null, true, 'the install entry left the card');
});

test('#30 an install that rejects shows the failure on the entry', { timeout: 30000 }, async () => {
  const { app } = await projectPage({
    status: deps({ status: 'missing', command: 'npm ci' }),
    install: async () => { throw new Error('spawn npm ENOENT'); },
  });
  await clickRendered(app, button(entry(app)));
  await app.settle(20);
  const el = entry(app);
  assert.equal(el === null, false, 'the entry stays');
  assert.equal(H.visibleText(el.inner).includes('spawn npm ENOENT'), true, H.visibleText(el.inner));
});

test('#30 in pt-BR the entry says the dependencies are missing and names npm ci', { timeout: 30000 }, async () => {
  const { app } = await projectPage({ status: deps({ status: 'missing', command: 'npm ci' }), lang: 'pt-BR' });
  const text = H.visibleText(entry(app)?.inner || '');
  assert.equal(/dependências/i.test(text), true, text);
  assert.equal(text.includes('npm ci'), true, text);
});
