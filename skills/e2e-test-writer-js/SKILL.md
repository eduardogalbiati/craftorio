---
name: e2e-test-writer-js
description: Writes and runs end-to-end BDD scenarios (Given/When/Then) for JavaScript/TypeScript projects with the E2E framework the project already uses (Cucumber.js, Playwright, playwright-bdd, Cypress + cucumber preprocessor); default Playwright + Cucumber.js. Use to add acceptance scenarios for a change and report each one's result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, commands to run only the run's scenarios"
used_by: "test writer"
---

# E2E scenarios: JavaScript / TypeScript

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Only this run's scenarios |
|---|---|---|---|
| `playwright-bdd` in devDependencies | playwright-bdd | `features/` (its config's `features`) | `npx bddgen && npx playwright test --grep "@issue-<n>"` |
| `@cucumber/cucumber` in devDependencies | Cucumber.js (+ Playwright if present) | `features/` (`cucumber.js` config) | `npx cucumber-js --tags "@issue-<n>"` |
| `@badeball/cypress-cucumber-preprocessor` | Cypress + Cucumber | `cypress/e2e/` | `npx cypress run --spec <file>.feature` |
| an Electron app with `scripts/smoke.js` and no BDD framework | node:test steps driving the smoke/screenshot scripts | `test/e2e/` | `node --test test/e2e/<file>.test.js` |

- **No E2E framework yet**: default to **Playwright + Cucumber.js** (`@cucumber/cucumber`,
  `@playwright/test`), feature files in `features/`, step definitions in `features/steps/`.
  Record the assumption in `e2e_note`. Adding the devDependencies is part of the tests: commit
  `package.json` and the lockfile with them.
- An Electron app that already has a scripted UI check (this orchestrator: `scripts/smoke.js`,
  `npm run screenshot`): write the `.feature` file and step definitions that drive those scripts
  rather than adding a browser framework.
- Browsers: `npx playwright install --with-deps chromium` only when the project uses Playwright and
  no browser is installed; when it fails, the UI scenarios are `skipped` (environment).
- Always non-interactive and headless (`CI=true`, never `--ui`, `--headed` or `cypress open`).
- Dependencies first: a fresh worktree has no `node_modules` (`npm ci` with the lockfile's manager).

## Idioms

- Tag each scenario with its issue (`@issue-143`) so the run's scenarios can be run alone.
- Playwright locators by role and label (`getByRole`, `getByLabel`), web-first assertions
  (`await expect(locator).toBeVisible()`), never fixed sleeps.
- Screenshots: `await page.screenshot({ path })` (or the Electron window's `capturePage()`) into
  `evidence_dir` with the e2e-scenarios naming.
- Close the browser / app in an `After` hook (`AfterAll` for a shared app), on failure too.
