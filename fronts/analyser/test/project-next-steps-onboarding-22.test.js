// #22 acceptance, written before the code: the Next steps card on the project's page
// (fronts/analyser/views/project/project.js, shown while localStorage craftorio.nextSteps[<project>] is
// 'open') follows what the onboarding recorded, on the real page (packages/ui-kit/test/renderer-app-harness.js)
// as project-next-steps-744.test.js drives it.
//
// The contract assumed here:
// - the project's Inbox is read with the existing api.listDiscoveryCards(<project id>, 'inbox') (as the Plan
//   home card does, fronts/plan/plan-home.js); with at least one card, the idea entry (next-step-idea) is
//   either left out, or shown done: an element data-testid="next-step-idea-done" (e.g. "✓") and no enabled
//   "Open the Inbox" button (data-next-step="idea"); with none, it stays as today (its enabled button);
// - the project's kind is the record's `kind` ('backend' | 'frontend' | 'full-stack', set by the wizard):
//   for 'backend' the screenshots entry (next-step-screenshots) is left out, or kept disabled with a
//   reason that says the project has no interface (pt-BR: "sem interface"), never the screenshots spike's
//   line about running the front; 'frontend' and 'full-stack' keep the entry as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { pageMarkup } = require('./project-page-helpers');

const PID = 'p1';
const BASE = { id: PID, name: 'Is Plain Obj', repo: 'https://github.com/o/is-plain-obj.git', folder: 'C:/ws/repos/is-plain-obj', exists: true, workflows: [{ name: 'feature', category: 'build', variant: 'local-code' }] };
const IDEA = { id: 'card-1', title: 'suportar objetos cross-realm', column: 'inbox', project: PID };
const clone = (x) => JSON.parse(JSON.stringify(x));

async function projectPage({ project = {}, inbox = [], lang = 'en' } = {}) {
  const app = loadApp({
    api: {
      listProjects: async () => [clone({ ...BASE, ...project })],
      onboardingStatus: async () => null,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      // the project's Inbox: the cards of this project only (a column filter or all of them)
      listDiscoveryCards: async (projectId, column) => (projectId === PID && (!column || column === 'inbox') ? clone(inbox) : []),
      listDiscoveryWaiting: async () => [],
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [PID]: 'open' }) },
  });
  await app.boot();
  if (lang !== 'en') app.sandbox.I18n.setLanguage(lang);
  app.run(`openProjectView(${JSON.stringify(PID)})`);
  await app.settle(30);
  return app;
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));
const entry = (app, step) => H.findEl(card(app)?.outer || '', (e) => e.name === 'li' && e.attrs['data-testid'] === `next-step-${step}`);
const enabledButton = (el, step) => H.findEl(el?.outer || '', (e) => e.name === 'button' && e.attrs['data-next-step'] === step && !('disabled' in e.attrs));
const doneMark = (el) => H.findEl(el?.outer || '', (e) => e.attrs['data-testid'] === 'next-step-idea-done');
// the entry's reason: its disabled button's tooltip and its visible lines
const reasonOf = (el) => {
  const button = H.findEl(el?.outer || '', (e) => e.name === 'button' && 'disabled' in e.attrs);
  return `${button?.attrs.title || ''} ${H.visibleText(el?.inner || '')}`;
};

// ---- the idea entry knows the Inbox -----------------------------------------------------------------

test('#22 with an idea in the project\'s Inbox, "Capture the first idea" is done or left out (no "Open the Inbox")', { timeout: 30000 }, async () => {
  const app = await projectPage({ inbox: [IDEA] });
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  const idea = entry(app, 'idea');
  if (idea === null) return; // left out: fine
  assert.equal(enabledButton(idea, 'idea') === null, true, `no enabled "Open the Inbox" in the idea entry: ${H.visibleText(idea.inner)}`);
  assert.equal(doneMark(idea) === null, false, 'the idea entry carries data-testid="next-step-idea-done"');
});

test('#22 in pt-BR, with an idea noted, "Registrar a primeira ideia · Abrir a Inbox" is no longer offered', { timeout: 30000 }, async () => {
  const app = await projectPage({ inbox: [IDEA], lang: 'pt-BR' });
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  const idea = entry(app, 'idea');
  const text = idea ? H.visibleText(idea.inner) : '';
  assert.equal(enabledButton(idea, 'idea') === null, true, `no enabled "Abrir a Inbox": ${text}`);
});

test('#22 with an empty Inbox, "Capture the first idea" still offers "Open the Inbox"', { timeout: 30000 }, async () => {
  const app = await projectPage({ inbox: [] });
  const idea = entry(app, 'idea');
  assert.equal(idea === null, false, 'the idea entry is shown');
  assert.equal(enabledButton(idea, 'idea') === null, false, 'its "Open the Inbox" button is enabled');
  assert.equal(doneMark(idea) === null, true, 'not marked done');
});

// ---- the screenshots entry follows the project's kind -----------------------------------------------

test('#22 a backend project (no UI) is not proposed the screenshots spike, or is told it has no interface', { timeout: 30000 }, async () => {
  const app = await projectPage({ project: { kind: 'backend' }, lang: 'pt-BR' });
  assert.equal(card(app) === null, false, 'the Next steps card is shown');
  const shots = entry(app, 'screenshots');
  if (shots === null) return; // not proposed: fine
  const text = H.visibleText(shots.inner);
  assert.equal(enabledButton(shots, 'screenshots') === null, true, `the screenshots step is not enabled: ${text}`);
  assert.equal(/sem interface/i.test(reasonOf(shots)), true, `its reason says "sem interface": ${reasonOf(shots)}`);
  assert.equal(text.includes('Um spike descobre como rodar o front'), false, `never the spike's line about the front: ${text}`);
});

for (const kind of ['frontend', 'full-stack']) {
  test(`#22 a ${kind} project keeps the screenshots entry as today`, { timeout: 30000 }, async () => {
    const app = await projectPage({ project: { kind }, lang: 'pt-BR' });
    const shots = entry(app, 'screenshots');
    assert.equal(shots === null, false, 'the screenshots entry is shown');
    const text = H.visibleText(shots.inner);
    assert.equal(text.includes('Investigar screenshots'), true, `its title: ${text}`);
    assert.equal(/sem interface/i.test(reasonOf(shots)), false, `no "sem interface" reason: ${reasonOf(shots)}`);
  });
}
