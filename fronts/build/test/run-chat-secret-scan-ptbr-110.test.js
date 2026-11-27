// #110 acceptance, written before the code: a run's secret scan that did not run says "Secrets not scanned: …" in
// English in the pt-BR run chat (fronts/build/views/runchat). The output is the engine's own: its secret_scan step
// (packages/engine/engine/run/secret-scan-step.js secretScan) turned off for the run, engine and page both in pt-BR;
// the run chat is the whole page (agent-chat-page-harness.js), as run-chat-unknown-cost-72.test.js draws it.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@craftorio/shared/i18n');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const RUN = 'r-110-scan';
const T0 = Date.parse('2026-11-27T10:00:00.000Z');

// the engine's secret_scan output for a run that turned it off (simulated machine: no gitleaks, no checkout needed)
async function scanOutput() {
  const { methods } = require('@craftorio/engine/engine/run/secret-scan-step');
  const run = { ...methods, ctx: { inputs: {}, vars: {}, steps: {}, worktree_dir: null }, machine: { simulated: true } };
  const out = await run.secretScan({ id: 'secret_scan', type: 'secret_scan', enabled: 'off' });
  return { kind: 'secret_scan', round: 1, findings: [], ignored: [], config: [], ...out };
}

async function chatText(lang) {
  I18n.setLanguage(lang);
  const output = await scanOutput();
  assert.equal(output.status, 'skipped', 'the engine skipped the scan');
  let seq = 0;
  const ev = (s, type, fields) => ({ seq: ++seq, run_id: RUN, ts: new Date(T0 + s * 1000).toISOString(), type, ...fields });
  const events = [
    ev(0, 'workflow.started', { workflow: 'fix', file: 'fix.yaml', inputs: { task: 'Fix it' }, mock: false }),
    ev(1, 'step.started', { step_id: 'secret_scan', visit: 1, step_type: 'secret_scan', agent: null }),
    ev(2, 'step.finished', { step_id: 'secret_scan', visit: 1, output: JSON.parse(JSON.stringify(output)) }),
  ];
  const page = await loadPage({ api: { runEvents: async () => events } });
  page.sandbox.__lang = lang;
  page.run('I18n.setLanguage(__lang)');
  page.sandbox.openRunChat({ runId: RUN, workflow: 'fix', running: false });
  await settle(20);
  return textOf(page.$('#rc-messages')).replace(/\s+/g, ' ').trim();
}

test.afterEach(() => I18n.setLanguage('en'));

test('#110 run chat in pt-BR: a secret scan turned off does not say "Secrets not scanned" in English', { timeout: 30000 }, async () => {
  const shown = await chatText('pt-BR');
  assert.notEqual(shown, '', 'the run chat draws the run');
  assert.equal(/Secrets not scanned|turned off for this run/.test(shown), false, shown);
});

test('#110 guard: the run chat in English says why the scan did not run', { timeout: 30000 }, async () => {
  const shown = await chatText('en');
  assert.match(shown, /Secrets not scanned: turned off for this run/);
});
