// @ts-check
// `type: secret_scan` (#49): the secret scan of a run's own commits, a step without an agent as those of
// machine-steps.js (`runSecretScanStep`; `secretScan` what it answers, `secretScanRefs` the refs whose
// commits are not the run's). packages/engine/engine/secret-scan.js runs gitleaks and reads its report.
// #110: a scan that did not run names its catalog key (message_key, message_params) next to its English message.

'use strict';

const fs = require('fs');
const { childEnv } = require('../child-env');
const { withCliPath } = require('../providers');
const secretScan = require('../secret-scan');
const { git } = require('../worktree');
const { render } = require('./templates');

const methods = {
  // `type: secret_scan` (#49): gitleaks on the run's own commits (packages/engine/engine/secret-scan.js), real in
  // a simulation too. `enabled`: a template, the input that turns it off ('off'); `since`: a template, the tag a
  // release scans from (empty: the whole history). Output: { kind: 'secret_scan', status: pass | fail | skipped | error, findings: [{ rule, file,
  // line, commit }], ignored, config, message, round }: skipped (off, no gitleaks, no checkout) and error (gitleaks
  // failed) both say "Secrets not scanned"; a simulation without the base's commits is skipped, a real run is an error.
  async runSecretScanStep(step, st) {
    const output = { kind: 'secret_scan', round: st.visits, findings: [], ignored: [], config: [], ...(await this.secretScan(step)) };
    this.emitEvent('log', { level: output.status === 'pass' ? 'info' : 'warn', kind: 'secret_scan', step_id: step.id, status: output.status, message: `${step.id}: ${output.message.split('\n')[0]}` });
    return output;
  },

  async secretScan(step) {
    const given = (key) => render(String(step[key]), this.ctx).trim();
    // #110: message stays English (prompts, the result summary); message_key/message_params give the screens' text
    const said = (key, params = {}) => ({ message_key: `engine.${key}`, message_params: params });
    const skipped = (why, key, params) => ({ status: 'skipped', message: `${secretScan.NOT_SCANNED}: ${why}.`, ...said(key, params) });
    const worktree = this.ctx.worktree_dir;
    if (step.enabled != null && /^(off|false|no)$/i.test(given('enabled'))) return skipped('turned off for this run', 'secret_scan_off');
    if (!worktree || !fs.existsSync(worktree)) return skipped('the run has no checkout', 'secret_scan_no_checkout');
    const file = await secretScan.findGitleaks();
    if (!file) return { status: 'skipped', message: secretScan.notInstalledMessage(), ...secretScan.notInstalledKey() };
    let dir;
    let range;
    try {
      // gitleaks reads its ignore file and its configuration from the repository's top folder
      dir = await git(['rev-parse', '--show-toplevel'], worktree);
      range = await secretScan.commitRange(dir, step.since != null ? { since: given('since') } : { refs: this.secretScanRefs() });
      // #116: zero commits is not a pass (a developer that committed nothing looked clean)
      if (!(await secretScan.commitCount(dir, range))) return skipped('the run has no commit of its own, nothing to scan', 'secret_scan_no_commits');
    } catch (e) {
      const error = String(e.message).split('\n')[0];
      const why = `the run's commits could not be read (${error})`;
      return this.machine.simulated ? skipped(why, 'secret_scan_commits', { error })
        : { status: 'error', message: `${secretScan.NOT_SCANNED}: ${why}.`, ...said('secret_scan_commits', { error }) };
    }
    const env = withCliPath(childEnv(process.env, { passthrough: this.envPassthrough() }));
    const scanned = await secretScan.scanSecrets({ dir, file, range, env, signal: this.abort.signal });
    return { ...scanned, ...(await secretScan.newEntries(dir, range)) };
  },

  // baseRefs (run/checkout.js), as the test guard reads them. A Remote run leaves the local base out (it may hold
  // commits that were never pushed) and adds the parent's branch of a stacked run (#807).
  secretScanRefs() {
    const refs = this.baseRefs();
    if (!this.worktree?.remote) return refs;
    const parent = String(this.ctx.inputs?.parent_branch ?? '').trim();
    return [...refs.filter((ref) => !ref.startsWith('refs/heads/')), ...(parent ? [`refs/remotes/origin/${parent}`] : [])];
  },
};

module.exports = {
  methods,
};
