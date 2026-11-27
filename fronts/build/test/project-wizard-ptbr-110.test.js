// #110 acceptance, written before the code: the new-project wizard (fronts/build/views/projects/project-wizard.js) in
// the pt-BR interface.
// - the analysis' Oracle line (wizard-phase-oracle, step 3) shows what the Oracle reads as the engine recorded it
//   (seed-runs.js readingOf: a tool call's name and target), so an MCP tool shows raw: "mcp__orchestrator__list_runs".
//   It must read as a label, in the interface language;
// - the push notice after a GitLab import (wizard-push-notice, #79) shows the engine's English fix line
//   (engine/push-access.js checkPushAccess: "Configure a git credential helper for gitlab.com, or set the remote to its
//   SSH URL."). What git said (its reason line) is not translated.
// On the real page through project-wizard-helpers.js, as project-wizard-phases-781.test.js drives it.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('@craftorio/ui-kit/test/page-pieces');
const W = require('./project-wizard-helpers');

const { PID, byTestId, clone, emit, press, wizardMarkup } = W;

const RAW_TOOL = 'mcp__orchestrator__list_runs';
const PROFILING = { projectId: PID, status: 'analyzing', cli: W.CLI_OK, jobs: W.jobs({ clone: { status: 'done' }, facts: { status: 'done' }, profile: { status: 'running' } }) };
const since = () => new Date(Date.now() - 5000).toISOString();
const oracleReading = (reading) => ({
  running: { since: since(), items: 3, last: reading },
  error: null,
  phases: {
    git: { status: 'done', found: { commits: 12, merges: 1, tags: 0, authors: 1 } },
    files: { status: 'done', found: { languages: ['js'], testCommand: 'npm test', ci: 'none' } },
    oracle: { status: 'running', since: since(), reading },
  },
});

const lineText = (app, id) => H.visibleText(byTestId(wizardMarkup(app), id)?.inner || '');

test('#110 wizard in pt-BR: the Oracle\'s line never shows an MCP tool\'s raw name', { timeout: 20000 }, async () => {
  const app = await W.atAnalysis({ api: { workflowInterviewState: async () => clone(oracleReading(RAW_TOOL)) } });
  app.sandbox.I18n.setLanguage('pt-BR');
  await press(app, 'wizard-workflows-choice-analyze');
  await emit(app, PROFILING);
  const line = lineText(app, 'wizard-phase-oracle');
  assert.notEqual(line, '', 'the Oracle line is drawn');
  assert.equal(/mcp__|list_runs|orchestrator__/.test(line), false, line);
});

// the engine's push check of a GitLab clone over HTTPS without git credentials
async function gitlabPushCheck() {
  const { checkPushAccess } = require('@craftorio/engine/engine/push-access');
  return checkPushAccess('/tmp/clone', {
    run: async (args) => {
      if (args[0] === 'remote') return 'https://gitlab.com/o/new.git\n';
      throw new Error("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled");
    },
  });
}

test('#110 wizard in pt-BR: the push notice after a GitLab import has no English line (git\'s own line stays)', { timeout: 20000 }, async () => {
  const check = await gitlabPushCheck();
  assert.equal(check.ok, false, 'the engine refuses the push');
  const app = await W.atAnalysis();
  app.sandbox.I18n.setLanguage('pt-BR');
  await emit(app, { ...W.READY, pushCheck: check });
  const notice = lineText(app, 'wizard-push-notice');
  assert.notEqual(notice, '', 'the push notice is drawn');
  assert.equal(/credential helper|set the remote to its SSH URL|Check that your account|so git pushes with/.test(notice), false, notice);
  assert.equal(notice.includes('could not read Username'), true, notice);
});
