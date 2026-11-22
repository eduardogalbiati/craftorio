// #739: the wizard fills the project name from the repository URL. Acceptance tests, written before the
// code, on the real page (packages/ui-kit/test/renderer-app-harness.js, through project-wizard-helpers.js).
// The contract assumed here:
// - typing or pasting in #wizard-repo (its input event) fills #wizard-name with
//   OnboardingModel.displayNameFromUrl(url) ("https://github.com/acme/ai-memory.git" → "Ai Memory");
// - once the owner edits #wizard-name (its input event) the URL no longer changes it; clearing it makes it
//   follow the URL again;
// - picking a repository of the list (wizard-repo-option data-repo="owner/repo") uses the same rule and
//   replaces an auto-filled name, never a typed one.
// What the name field shows: its live value when the code set it in place, else the value="" of the
// rendered input; the name the import sends (api.startOnboarding's `name` on Next) is checked too.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const AI_MEMORY = 'https://github.com/acme/ai-memory.git';
const PHARMAGED = 'https://gitlab.com/eduardogalbiati/pharmaged';

const ACCOUNTS = [{ provider: 'github', cli: 'gh', installed: true, signedIn: true, account: 'acme' }];
const REPOS = {
  github: [
    { name: 'acme/ai-memory', private: false, updatedAt: '2026-10-30T10:00:00Z' },
    { name: 'acme/pharmaged', private: true, updatedAt: '2026-10-29T10:00:00Z' },
  ],
};

/** What the name field shows: its live value, else the rendered input's value. */
function nameShown(app) {
  const live = String(W.existing(app, 'wizard-name')?.value || '');
  if (live) return live;
  const input = H.findEl(W.wizardMarkup(app), (e) => e.attrs.id === 'wizard-name');
  return input ? String(input.attrs.value || '') : '';
}

/** Next on the repository step: the name api.startOnboarding received ('' when it was not called). */
async function sentName(app) {
  await W.press(app, 'wizard-next');
  const call = app.callsTo('startOnboarding')[0];
  return call ? String(call[0]?.name ?? '') : '';
}

async function atRepository(opts) {
  const app = await W.opened(opts);
  await W.toRepository(app);
  assert.equal(W.currentStep(app), 'repository');
  return app;
}

async function pick(app, repo) {
  const el = H.findEl(W.wizardMarkup(app), (e) => e.attrs['data-testid'] === 'wizard-repo-option' && e.attrs['data-repo'] === repo);
  assert.ok(el, `the repository list offers ${repo}`);
  await W.clickRendered(app, el, ['#project-wizard']);
  await app.settle(10);
}

// ---- typing / pasting the URL ----------------------------------------------------------------------

test('#739 pasting a repository URL fills the empty project name with its display name', async () => {
  const app = await atRepository();
  await W.typeInto(app, '#wizard-repo', AI_MEMORY);
  assert.equal(nameShown(app), 'Ai Memory');
  assert.equal(await sentName(app), 'Ai Memory', 'the import is started with the filled name');
});

test('#739 an auto-filled name follows the URL as it changes', async () => {
  const app = await atRepository();
  await W.typeInto(app, '#wizard-repo', AI_MEMORY);
  await W.typeInto(app, '#wizard-repo', PHARMAGED);
  assert.equal(nameShown(app), 'Pharmaged');
  assert.equal(await sentName(app), 'Pharmaged');
});

test('#739 once the owner typed a name, changing the URL keeps it', async () => {
  const app = await atRepository();
  await W.typeInto(app, '#wizard-repo', AI_MEMORY);
  await W.typeInto(app, '#wizard-name', 'My memory');
  await W.typeInto(app, '#wizard-repo', PHARMAGED);
  assert.equal(nameShown(app), 'My memory');
  assert.equal(await sentName(app), 'My memory');
});

test('#739 clearing the typed name makes it follow the URL again', async () => {
  const app = await atRepository();
  await W.typeInto(app, '#wizard-repo', AI_MEMORY);
  await W.typeInto(app, '#wizard-name', 'My memory');
  await W.typeInto(app, '#wizard-name', '');
  await W.typeInto(app, '#wizard-repo', PHARMAGED);
  assert.equal(nameShown(app), 'Pharmaged');
  assert.equal(await sentName(app), 'Pharmaged');
});

// ---- picking from the list ---------------------------------------------------------------------------

test('#739 picking a repository from the list fills the name with the same rule (acme/ai-memory → "Ai Memory")', async () => {
  const app = await atRepository({ accounts: ACCOUNTS, repos: REPOS });
  await pick(app, 'acme/ai-memory');
  assert.equal(nameShown(app), 'Ai Memory');
  assert.equal(await sentName(app), 'Ai Memory');
});

test('#739 picking a second repository replaces the auto-filled name', async () => {
  const app = await atRepository({ accounts: ACCOUNTS, repos: REPOS });
  await pick(app, 'acme/ai-memory');
  await pick(app, 'acme/pharmaged');
  assert.equal(nameShown(app), 'Pharmaged');
  assert.equal(await sentName(app), 'Pharmaged');
});

test('#739 picking a repository keeps a name the owner typed', async () => {
  const app = await atRepository({ accounts: ACCOUNTS, repos: REPOS });
  await W.typeInto(app, '#wizard-name', 'Mine');
  await pick(app, 'acme/pharmaged');
  assert.equal(nameShown(app), 'Mine');
  assert.equal(await sentName(app), 'Mine');
});
