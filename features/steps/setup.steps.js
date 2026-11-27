// Steps of features/setup.feature (#319): the first-run Setup on a new workspace, Skip and its
// confirm, setupDone in the workspace's settings.json, Settings › Agents & CLIs › "Run setup again".
// Locators are roles and data-testid only (skills/ui-conventions):
//   setup                                   the Setup (a large modal or screen)
//   setup-step-<slug>                       a stepper item: agents ("Connect your AIs"), versioning ("Version
//                                           control"), first-project (#643: no workflows step any more;
//                                           #69: no try-it-safely step either); the current one has
//                                           aria-current="step"
//   setup-cli-<id>                          a CLI's card: claude, codex, grok on the AIs step; git, gitleaks,
//                                           gh, glab on the Version control step; its status reads Ready /
//                                           Not signed in / Not installed / Checking…, its badge "Required"
//                                           or "Optional"
//   setup-check-again                       Check again, beside the step's title (disabled while the CLIs
//                                           are being checked)
//   setup-skip, setup-next, setup-back      the Setup's buttons. The steps that list CLIs have no Skip, and
//                                           their Next is disabled (its title says why) without a ready AI
//                                           CLI (AIs step) / without Git (Version control step)
//   setup-simulation-only                   "Continue with simulations only": the way on while Next is locked
//   confirm-modal                           the app's confirm dialog (index.html), Skip's confirm
//   settings-developer-mode                 (#69, the developer adds it) the checkbox of Settings ›
//                                           Execution › Developer mode (data-setting="developerMode")
// (#643) the last step, First project, opens the project wizard (onboarding.steps.js) by itself on a
// workspace with no project, as it opened the old New project dialog.
// "Run setup again" is a button of Settings › Agents & CLIs, by its role and name.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

const CLIS = [
  ['Claude Code', 'claude'],
  ['Codex CLI', 'codex'],
  ['Grok Build', 'grok'],
  ['GitHub CLI', 'gh'],
  ['GitLab CLI', 'glab'],
  ['Git', 'git'],
];
// #49: gitleaks, an optional tool with a row of its own (setup-cli-gitleaks), not one of the CLIs above
const TOOLS = [...CLIS, ['Gitleaks', 'gitleaks']];
const cliId = (name) => {
  const found = TOOLS.find(([n]) => n === name);
  if (!found) throw new Error(`unknown CLI "${name}" (one of ${TOOLS.map(([n]) => n).join(', ')})`);
  return found[1];
};
// a step by the name its pill reads; any other name is a slug of its own (a step that must not exist)
const STEP_SLUG = { 'Connect your AIs': 'agents', 'Version control': 'versioning', 'First project': 'first-project' };
const stepSlug = (name) => STEP_SLUG[name] || name.toLowerCase().replace(/\s+/g, '-');
// the steps that list CLIs (no Skip there)
const TOOL_STEPS = ['setup-step-agents', 'setup-step-versioning'];
const CHECK_TIMEOUT = 45000;
const STATUS = /Ready|Not signed in|Not installed|Checking…/;

const setup = (page) => page.getByTestId('setup');
const stepItem = (page, name) => setup(page).getByTestId(`setup-step-${stepSlug(name)}`);
const cliRow = (page, name) => setup(page).getByTestId(`setup-cli-${cliId(name)}`);

// a first start: the workspace folder is not seeded (no settings.json, no project)
Given('the app is open on a new workspace', async ({ e2e }) => {
  await e2e.open({ empty: true });
});

Then('the first-run Setup is open on its {string} step', async ({ e2e }, name) => {
  const page = e2e.window;
  await expect(setup(page)).toBeVisible({ timeout: 30000 });
  await expect(stepItem(page, name)).toHaveAttribute('aria-current', 'step');
});

async function stepperReads(page, names) {
  for (const name of names) {
    await expect(stepItem(page, name)).toBeVisible();
    await expect(stepItem(page, name)).toContainText(name);
  }
  // in this order in the stepper
  const ids = names.map((n) => `setup-step-${stepSlug(n)}`);
  const inOrder = await setup(page).evaluate((root, list) => {
    const els = list.map((id) => root.querySelector(`[data-testid="${id}"]`));
    return els.every((el, i) => i === 0 || (els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  }, ids);
  expect(inOrder, `the stepper reads ${names.join(', ')} in this order`).toBe(true);
  // and nothing else (#643: no Workflows; #69: no Try it safely)
  await expect(setup(page).locator('[data-testid^="setup-step-"]')).toHaveCount(names.length);
}

Then("the Setup's stepper reads {string}, {string} and {string}", async ({ e2e }, a, b, c) => {
  await stepperReads(e2e.window, [a, b, c]);
});

Then("the Setup's stepper has no {string} step", async ({ e2e }, name) => {
  await expect(stepItem(e2e.window, 'Connect your AIs')).toBeVisible();
  await expect(stepItem(e2e.window, name)).toHaveCount(0);
  await expect(setup(e2e.window).getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

// The step after the current one. On a step that lists CLIs the way on depends on the machine: Next when the
// step's need is met (a ready AI CLI; Git), else Next is locked and "Continue with simulations only" goes on.
// Exactly one of the two is offered, once the CLIs are checked.
async function goToNextStep(page) {
  const s = setup(page);
  const before = await s.locator('[aria-current="step"]').getAttribute('data-testid');
  const next = s.getByTestId('setup-next');
  if (TOOL_STEPS.includes(before)) {
    const simulation = s.getByTestId('setup-simulation-only');
    await expect(s.getByTestId('setup-check-again'), 'the CLIs are checked').toBeEnabled({ timeout: CHECK_TIMEOUT });
    if (await next.isEnabled()) {
      await expect(simulation, 'no simulation-only way on while Next is open').toBeHidden();
      await next.click();
    } else {
      await expect(next, 'a locked Next says why').toHaveAttribute('title', /\S/);
      await expect(simulation).toBeVisible();
      await simulation.click();
    }
  } else await next.click();
  await expect(s.locator('[aria-current="step"]')).not.toHaveAttribute('data-testid', before);
}

When("I go to the Setup's next step", async ({ e2e }) => {
  await goToNextStep(e2e.window);
});

// a first start on a machine with none of the AI CLIs (the E2E hook of settings-clis.steps.js, simulation only):
// the AIs step's Next is locked whatever the machine running the scenarios has
Given('the app is open on a new workspace of a machine with no AI CLI', async ({ e2e }) => {
  await e2e.open({ empty: true, env: { CRAFTORIO_E2E_CLI_MISSING: 'claude,codex,grok' } });
});

async function listsWithStatus(page, names) {
  for (const name of names) {
    const row = cliRow(page, name);
    await expect(row, `the Setup's card for ${name}`).toBeVisible();
    await expect(row).toContainText(name);
    await expect(row).toContainText(STATUS);
  }
  // this step's CLIs only (setup-cli-output is a card's own part: what its check printed)
  await expect(setup(page).locator('[data-testid^="setup-cli-"]:not([data-testid="setup-cli-output"])').filter({ visible: true })).toHaveCount(names.length);
}

Then('the Setup lists Claude Code, Codex CLI and Grok Build, each with a status', async ({ e2e }) => {
  await listsWithStatus(e2e.window, ['Claude Code', 'Codex CLI', 'Grok Build']);
});

Then('the Setup lists Git, Gitleaks, GitHub CLI and GitLab CLI, each with a status', async ({ e2e }) => {
  await listsWithStatus(e2e.window, ['Git', 'Gitleaks', 'GitHub CLI', 'GitLab CLI']);
});

Then('the Setup marks {string} as required', async ({ e2e }, name) => {
  await expect(cliRow(e2e.window, name)).toContainText('Required');
});

// #49: a tool no run needs: its badge reads "Optional", never "Required" (what it is for is the card's own line)
Then('the Setup marks {string} as optional', async ({ e2e }, name) => {
  const row = cliRow(e2e.window, name);
  await expect(row).toContainText('Optional');
  await expect(row).not.toContainText('Required');
});

// the steps that list CLIs cannot be skipped
Then('the Setup offers no Skip on this step', async ({ e2e }) => {
  const page = e2e.window;
  await expect(setup(page).locator('[aria-current="step"]')).toHaveAttribute('data-testid', new RegExp(`^(${TOOL_STEPS.join('|')})$`));
  await expect(setup(page).getByTestId('setup-skip')).toBeHidden();
  await expect(setup(page).getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
});

// Next locked: disabled, its title the reason, and the way on for simulations offered instead
Then("the Setup's Next is locked, saying {string}, and it offers {string} instead", async ({ e2e }, reason, label) => {
  const s = setup(e2e.window);
  await expect(s.getByTestId('setup-check-again'), 'the CLIs are checked').toBeEnabled({ timeout: CHECK_TIMEOUT });
  const next = s.getByTestId('setup-next');
  await expect(next).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(next).toHaveAttribute('title', reason);
  const simulation = s.getByTestId('setup-simulation-only');
  await expect(simulation).toBeVisible();
  await expect(simulation).toHaveText(label);
  await expect(simulation).toBeEnabled();
});

Then('the Setup reads {string} for {string}', async ({ e2e }, status, name) => {
  await expect(cliRow(e2e.window, name)).toContainText(status, { timeout: 45000 });
});

// the platform's command, or the hint of one without a one-line installer: both name the program (the
// row's own name is "Gitleaks"), and ▶ Install is there
Then('the Setup shows how to install {string}', async ({ e2e }, name) => {
  const row = cliRow(e2e.window, name);
  await expect(row.getByRole('button', { name: /Install/ })).toBeVisible({ timeout: 45000 });
  // in any case: winget's package id is "Gitleaks.Gitleaks", brew's and the distributions' "gitleaks"
  await expect(row).toContainText(new RegExp(`(install|winget|brew)[^\\n]*${cliId(name)}`, 'i'));
});

// Skip is on the last step only (the steps that list CLIs have none): from an earlier step this goes on to it
// first, and closes the project wizard that a workspace with no project opens there by itself (#643)
When('I skip the Setup and confirm', async ({ e2e }) => {
  const page = e2e.window;
  await expect(setup(page)).toBeVisible({ timeout: 30000 });
  const current = setup(page).locator('[aria-current="step"]');
  let walked = false;
  for (let i = 0; i < TOOL_STEPS.length && TOOL_STEPS.includes(await current.getAttribute('data-testid')); i++) {
    await goToNextStep(page);
    walked = true;
  }
  await expect(stepItem(page, 'First project')).toHaveAttribute('aria-current', 'step');
  if (walked) {
    // arriving on First project with no project opens the wizard over the Setup: wait for it, then close it
    const wizard = page.getByTestId('project-wizard');
    await wizard.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await wizard.isVisible()) {
      await wizard.getByTestId('wizard-close').click();
      const ask = page.getByTestId('confirm-modal');
      await expect.poll(async () => (await ask.isVisible()) || !(await wizard.isVisible())).toBe(true);
      if (await ask.isVisible()) {
        await ask.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
        await expect(ask).toBeHidden();
      }
      await expect(wizard).toBeHidden();
    }
  }
  await expect(setup(page).getByTestId('setup-skip')).toBeVisible();
  // a native confirm, if the app uses one, is accepted; otherwise the app's confirm dialog
  const onDialog = (dialog) => dialog.accept().catch(() => {});
  page.once('dialog', onDialog);
  await setup(page).getByTestId('setup-skip').click();
  const confirm = page.getByTestId('confirm-modal');
  await expect(confirm.or(setup(page)).first()).toBeVisible();
  if (await confirm.isVisible()) {
    await confirm.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
    await expect(confirm).toBeHidden();
  }
  page.off('dialog', onDialog);
});

// stays away for a moment once Home is there (the Setup opens after the window's start-up checks)
Then('the first-run Setup is not shown', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true })).toBeVisible({ timeout: 30000 });
  for (let i = 0; i < 4; i++) {
    await expect(setup(page)).toBeHidden();
    await page.waitForTimeout(500);
  }
  await expect(setup(page)).toBeHidden();
});

// the workspace's settings.json as saved, null while it cannot be read (not written yet)
function savedSettings(e2e) {
  try { return JSON.parse(fs.readFileSync(path.join(e2e.scratch, 'workspace', 'settings.json'), 'utf8')); } catch { return null; }
}

Then('the workspace settings record the setup as done', async ({ e2e }) => {
  await expect.poll(() => savedSettings(e2e)?.setupDone).toBe(true);
});

// ---- #69: the Setup leaves the simulation mode (Settings › Execution › Developer mode) as it is -------
// state: on | off
function switchState(state) {
  if (!['on', 'off'].includes(state)) throw new Error(`unknown switch state "${state}" (on or off)`);
  return state === 'on';
}

// Finish: the Setup's button on its last step
When('I finish the Setup', async ({ e2e }) => {
  const page = e2e.window;
  await expect(stepItem(page, 'First project')).toHaveAttribute('aria-current', 'step');
  await setup(page).getByTestId('setup-next').click();
  await expect(setup(page)).toBeHidden({ timeout: 30000 });
});

// off: false or not written (the default); an unreadable file is neither
Then('the workspace settings have developer mode {string}', async ({ e2e }, state) => {
  const on = switchState(state);
  await expect.poll(() => {
    const saved = savedSettings(e2e);
    return saved ? !!saved.developerMode : null;
  }).toBe(on);
});

Then('the developer mode switch is {string}', async ({ e2e }, state) => {
  const on = switchState(state);
  await expect(e2e.window.getByTestId('settings-developer-mode')).toBeChecked({ checked: on, timeout: 30000 });
});

When('I ask to run the setup again', async ({ e2e }) => {
  await e2e.window.getByRole('button', { name: 'Run setup again', exact: true }).click();
});

// ---- #23: the Setup in Português (Brasil) ----------------------------------------------------------------
// The Setup's own "Interface language" select (data-testid="setup-language", a native select labelled by
// the language's name) saves the interface language at once; the page's html lang follows it.
// The machine line (data-testid="machine-profile-line", the engine's machine profile), in Settings › Execution ›
// Concurrent runs (#69: the Setup's Try it safely step is gone), reads in the interface language once read: in
// Português (Brasil) none of the English line's words ("This machine: 20 threads, 32 GB → up to 5 runs at once,
// 2 test workers per run") is left.
const LANGUAGE_CODE = { English: 'en', 'Português (Brasil)': 'pt-BR' };
const ENGLISH_MACHINE_WORDS = ['This machine', 'run at once', 'runs at once', 'test worker', 'per run', "couldn't be read"];

When("I choose {string} as the Setup's language", async ({ e2e }, label) => {
  const page = e2e.window;
  const code = LANGUAGE_CODE[label];
  if (!code) throw new Error(`no catalog for the language "${label}" (known: ${Object.keys(LANGUAGE_CODE).join(', ')})`);
  const select = setup(page).getByTestId('setup-language');
  await expect(select).toBeVisible({ timeout: 30000 });
  await select.selectOption({ label });
  await expect(page.locator('html')).toHaveAttribute('lang', code, { timeout: 30000 });
});

Then('the line about this machine reads in {string}', async ({ e2e }, language) => {
  const line = e2e.window.getByTestId('machine-profile-line').filter({ visible: true });
  // the profile is read: the line has text (an empty one is not visible)
  await expect(line).toBeVisible({ timeout: 30000 });
  await expect(line).toHaveText(/\d/, { timeout: 30000 });
  const text = (await line.innerText()).replace(/\s+/g, ' ').trim();
  if (language === 'English') {
    expect(text, 'the machine line in English').toMatch(/This machine/);
    return;
  }
  if (language !== 'Português (Brasil)') throw new Error(`unknown language "${language}"`);
  expect(ENGLISH_MACHINE_WORDS.filter((w) => text.includes(w)), `English words left in the machine line "${text}"`).toEqual([]);
  expect(text, 'the machine line names the machine in Portuguese').toMatch(/máquina/i);
});
