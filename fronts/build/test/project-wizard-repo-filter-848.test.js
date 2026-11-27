// #848: the list of the account's repositories on the wizard's Repository step (Import a repository, GitHub)
// filters as the owner types. Acceptance tests, written before the code, on the real page
// (packages/ui-kit/test/renderer-app-harness.js, through project-wizard-helpers.js).
// Layout rework of 2026-11-26 (the owner's decision): "Your repositories" has its own filter box,
// #wizard-repo-filter ("Filter by name"), above the list; the URL field (#wizard-repo, under the list) no longer
// filters it: it only marks (aria-pressed) the listed repository its URL names.
// The contract assumed here:
// - typing in #wizard-repo-filter (its input event, as W.typeInto fires it) lists the repositories whose
//   owner/name contains the typed text, case-insensitive, at most 5 (wizard-repo-list, items
//   wizard-repo-option data-repo="owner/name"; wizard-repo-more says so when more match); a full owner/name
//   matches too;
// - an empty filter lists the first 5 repositories in the order api.onboardingRepos returned them;
// - no match: no list at all (wizard-repo-none says so); a URL typed in #wizard-repo that is none of the
//   account's repositories is still imported by Next (api.startOnboarding's `repo`);
// - a click on a listed option fills the URL field (https://github.com/owner/name) and the name.
// What the list shows: the harness keeps #wizard-repo-slot as its own fake element, so a render of the
// wizard (#project-wizard's innerHTML) and a write into the slot are both recorded, and the latest wins.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');
const M = require('../../../packages/shared/onboarding-model.js');

const ACCOUNTS = [{ provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'eduardogalbiati' }];
const NAMES = [
  'eduardogalbiati/multiagent',
  'acme/ai-memory',
  'eduardogalbiati/pharmaged',
  'acme/shop',
  'eduardogalbiati/dotfiles',
  'acme/blog',
  'eduardogalbiati/FreeMyTvWebOS', // 7th: not among the 5 newest
  'acme/notes',
  'acme/api',
  'acme/cli', // 6 acme/ repositories in all, 4 eduardogalbiati/ ones
];
const REPOS = {
  github: NAMES.map((name, i) => ({ name, private: i % 2 === 1, updatedAt: new Date(Date.parse('2026-11-19T10:00:00Z') - i * 86400000).toISOString() })),
};
const FREEMY = 'eduardogalbiati/FreeMyTvWebOS';
const FREEMY_URL = `https://github.com/${FREEMY}`;

// Records, in order, what is written into the wizard's root and into #wizard-repo-slot
function track(app) {
  let seq = 0;
  const last = {};
  const hook = (el, key) => {
    let html = String(el.innerHTML || '');
    last[key] = { html, at: seq++ };
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      enumerable: true,
      get: () => html,
      set: (v) => { html = String(v); last[key] = { html, at: seq++ }; },
    });
  };
  hook(W.existing(app, 'project-wizard'), 'root');
  hook(app.el('#wizard-repo-slot'), 'slot');
  // the markup the list is read from: the slot's own write when it is the latest, else the last render
  return () => (last.slot.at > last.root.at ? last.slot.html : last.root.html);
}

async function atRepository() {
  const app = await W.opened({ accounts: ACCOUNTS, repos: REPOS });
  await W.toRepository(app);
  assert.equal(W.currentStep(app), 'repository');
  const listMarkup = track(app);
  return { app, listMarkup };
}

const FILTER = '#wizard-repo-filter';
const pressedOf = (html) => H.findAll(html, (e) => e.attrs['data-testid'] === 'wizard-repo-option' && e.attrs['aria-pressed'] === 'true').map((e) => String(e.attrs['data-repo']));
const listShown = (html) => !!H.findEl(html, (e) => e.attrs['data-testid'] === 'wizard-repo-list');
const optionsOf = (html) => H.findAll(html, (e) => e.attrs['data-testid'] === 'wizard-repo-option').map((e) => String(e.attrs['data-repo']));

async function pick(app, html, repo) {
  const el = H.findEl(html, (e) => e.attrs['data-testid'] === 'wizard-repo-option' && e.attrs['data-repo'] === repo);
  assert.ok(el, `the repository list offers ${repo}`);
  await W.clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

/** Next on the repository step: what api.startOnboarding received ({ repo, name }, '' when not called). */
async function sent(app) {
  await W.press(app, 'wizard-next');
  const call = app.callsTo('startOnboarding')[0];
  return { repo: call ? String(call[0]?.repo ?? '') : '', name: call ? String(call[0]?.name ?? '') : '' };
}

// ---- filtering as you type ---------------------------------------------------------------------------

test('#848 typing part of a name in lowercase (freemy) lists FreeMyTvWebOS, even outside the 5 newest', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'freemy');
  assert.deepEqual(optionsOf(listMarkup()), [FREEMY]);
});

test('#848 the match is case-insensitive on the owner and the name (AI-MEM lists acme/ai-memory)', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'AI-MEM');
  assert.deepEqual(optionsOf(listMarkup()), ['acme/ai-memory']);
});

test('#848 typing the owner lists only that owner\'s repositories', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'EduardoGalbiati');
  assert.deepEqual(optionsOf(listMarkup()), ['eduardogalbiati/multiagent', 'eduardogalbiati/pharmaged', 'eduardogalbiati/dotfiles', FREEMY]);
});

test('#848 the full owner/name lists that repository', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, FREEMY);
  assert.deepEqual(optionsOf(listMarkup()), [FREEMY]);
});

// the URL field no longer filters the list (the owner's decision): it marks the listed repository its URL names
test('#848 the https URL of a listed repository, typed in the URL field, marks it in the list, which is not filtered', async () => {
  const { app, listMarkup } = await atRepository();
  assert.deepEqual(pressedOf(listMarkup()), []);
  await W.typeInto(app, '#wizard-repo', 'https://github.com/acme/shop');
  assert.deepEqual(optionsOf(listMarkup()), NAMES.slice(0, 5));
  assert.deepEqual(pressedOf(listMarkup()), ['acme/shop']);
});

test('#848 a URL typed up to the owner (no slash after it) in the URL field leaves the list as it was, nothing marked', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, '#wizard-repo', 'https://github.com/eduardogalbiati');
  assert.deepEqual(optionsOf(listMarkup()), NAMES.slice(0, 5));
  assert.deepEqual(pressedOf(listMarkup()), []);
});

test('#848 the URL field and the filter work together: the filter narrows the list, the URL marks its repository in it', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, '#wizard-repo', FREEMY_URL);
  assert.deepEqual(optionsOf(listMarkup()), NAMES.slice(0, 5), 'the URL alone filters nothing');
  await W.typeInto(app, FILTER, 'freemy');
  assert.deepEqual(optionsOf(listMarkup()), [FREEMY]);
  assert.deepEqual(pressedOf(listMarkup()), [FREEMY]);
});

test('#848 at most 5 options when more repositories match', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'acme/'); // 6 repositories match
  const shown = optionsOf(listMarkup());
  assert.equal(shown.length, 5);
  assert.equal(shown.filter((n) => n.startsWith('acme/')).length, 5);
  const more = H.findEl(listMarkup(), (e) => e.attrs['data-testid'] === 'wizard-repo-more');
  assert.equal(H.visibleText(more?.inner || ''), 'Only the 5 most recent are shown. Use the filter to find another.');
});

test('#848 5 or fewer matches: no "only the 5 most recent" line', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'eduardogalbiati/');
  assert.equal(optionsOf(listMarkup()).length, 4);
  assert.equal(H.findEl(listMarkup(), (e) => e.attrs['data-testid'] === 'wizard-repo-more'), null);
});

// ---- empty field ---------------------------------------------------------------------------------------

test('#848 an empty filter lists the first 5 repositories in the order the API returned them', async () => {
  const { app, listMarkup } = await atRepository();
  assert.deepEqual(optionsOf(listMarkup()), NAMES.slice(0, 5));
});

test('#848 clearing the filter lists the first 5 again', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'freemy');
  assert.deepEqual(optionsOf(listMarkup()), [FREEMY]);
  await W.typeInto(app, FILTER, '');
  assert.deepEqual(optionsOf(listMarkup()), NAMES.slice(0, 5));
});

// ---- no match ------------------------------------------------------------------------------------------

test('#848 no matching repository: no list is rendered, a line says so', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'unknown-thing');
  assert.equal(listShown(listMarkup()), false);
  assert.equal(optionsOf(listMarkup()).length, 0);
  const none = H.findEl(listMarkup(), (e) => e.attrs['data-testid'] === 'wizard-repo-none');
  assert.equal(H.visibleText(none?.inner || ''), 'No repository with that name.');
});

test('#848 no matching repository: Next still imports the typed URL', async () => {
  const { app } = await atRepository();
  await W.typeInto(app, '#wizard-repo', 'https://github.com/someone/unknown-thing');
  assert.equal((await sent(app)).repo, 'https://github.com/someone/unknown-thing');
});

// ---- picking a filtered option -------------------------------------------------------------------------

test('#848 a click on a filtered option fills the field with its https URL and the name', async () => {
  const { app, listMarkup } = await atRepository();
  await W.typeInto(app, FILTER, 'freemy');
  await pick(app, listMarkup(), FREEMY);
  const input = H.findEl(W.wizardMarkup(app), (e) => e.attrs.id === 'wizard-repo');
  assert.equal(String(input?.attrs.value || ''), FREEMY_URL);
  assert.deepEqual(pressedOf(W.wizardMarkup(app)), [FREEMY], 'the picked repository is marked, the filter kept');
  const { repo, name } = await sent(app);
  assert.equal(repo, FREEMY_URL);
  assert.equal(name, M.displayNameFromUrl(FREEMY));
});
