---
name: e2e-test-writer-js
description: Writes end-to-end BDD scenarios (Given/When/Then) for JavaScript/TypeScript projects with the E2E framework the project already uses (Cucumber.js, Playwright, playwright-bdd, Cypress + cucumber preprocessor); default Playwright + Cucumber.js. In a development run it checks that they parse and reports them as pending; the E2E release workflow runs the whole suite.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands"
used_by: "test writer, E2E runner"
---

# E2E scenarios: JavaScript / TypeScript

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Development run: check they parse | Release run: one feature file |
|---|---|---|---|---|
| `playwright-bdd` in devDependencies | playwright-bdd | `features/` (its config's `features`) | `npx bddgen` then `npx playwright test --list --grep "@issue-<n>"` | `npx bddgen && npx playwright test <generated spec of the file>` |
| `@cucumber/cucumber` in devDependencies | Cucumber.js (+ Playwright if present) | `features/` (`cucumber.js` config) | `npx cucumber-js --dry-run --tags "@issue-<n>"` | `npx cucumber-js <file>.feature` |
| `@badeball/cypress-cucumber-preprocessor` | Cypress + Cucumber | `cypress/e2e/` | read the feature against the step definitions (no dry run); say so in `e2e_note` | `npx cypress run --spec <file>.feature` |
| an Electron app with `scripts/smoke.js` and no BDD framework | node:test steps driving the smoke/screenshot scripts | `test/e2e/` | `node --check test/e2e/<file>.test.js` | `node --test test/e2e/<file>.test.js` |

- **No E2E framework yet**: default to **Playwright + Cucumber.js** (`@cucumber/cucumber`,
  `@playwright/test`), feature files in `features/`, step definitions in `features/steps/`.
  Record the assumption in `e2e_note`. Adding the devDependencies is part of the tests: add them
  with the package manager (`npm install -D …`) and commit `package.json` and the lockfile; the
  engine installs the new lockfile into the shared dependency cache after your turn.
- An Electron app that already has a scripted UI check (this orchestrator: `scripts/smoke.js`,
  `npm run screenshot`): write the `.feature` file and step definitions that drive those scripts
  rather than adding a browser framework.
- **Development run** (the test step of software-development / -local-hero): write the scenarios
  and check that they parse with the command of the table; never start Electron, the app or a
  browser for them, and never install browsers. Each is reported `pending` (run at release).
- **Release run** (e2e-release): run the whole suite one feature file at a time, within the time
  budget the prompt gives. Browsers: `npx playwright install chromium` only when the project uses
  Playwright and no browser is installed; when it fails, the UI scenarios are `skipped`
  (environment). `npm run screenshot` waits for the machine's screenshot slot: one Electron
  screenshot at a time across all runs.
- Always non-interactive and headless (`CI=true`, never `--ui`, `--headed` or `cypress open`).
- Dependencies are ready: the engine links `node_modules` from the shared cache. Never run
  `npm ci` and never delete `node_modules` (it would empty the cache for every run).

## Idioms

- Tag each scenario with its issue (`@issue-143`) so the run's scenarios can be found and run alone.
- Playwright locators by role and label (`getByRole`, `getByLabel`), web-first assertions
  (`await expect(locator).toBeVisible()`), never fixed sleeps.
- Screenshots (release run): `await page.screenshot({ path })` (or the Electron window's
  `capturePage()`) into `evidence_dir` with the e2e-scenarios naming.
- Close the browser / app in an `After` hook (`AfterAll` for a shared app), on failure too.
