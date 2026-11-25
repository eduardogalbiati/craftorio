// @ts-check
// `type: secret_scan` (#49): the secret scan of a run's own commits, a step without an agent as those of
// machine-steps.js (`runSecretScanStep`; `secretScan` what it answers, `secretScanBase` the refs whose
// commits are not the run's). packages/engine/engine/secret-scan.js runs gitleaks and reads its report.

'use strict';

const fs = require('fs');
const { childEnv } = require('../child-env');
const { withCliPath } = require('../providers');
const secretScan = require('../secret-scan');
const { git } = require('../worktree');
const { render } = require('./templates');

const methods = {
  // `type: secret_scan` (#49): gitleaks on the run's own commits (packages/engine/engine/secret-scan.js), real in
  // a simulation too. `enabled`: a template, the input that turns it off ('off'); `base`: a template, the base
  // branch of a run without a worktree of its own; `since`: a template, the tag a release scans from (empty: the
  // whole history). Output: { kind: 'secret_scan', status: pass | fail | skipped | error, findings: [{ rule, file,
  // line, commit }], ignored, config, message, round }: skipped (off, no gitleaks, no checkout) and error (gitleaks
  // failed) both say "Secrets not scanned"; a simulation without the base's commits is skipped, a real run is an error.
  async runSecretScanStep(step, st) {
    const output = { kind: 'secret_scan', round: st.visits, findings: [], ignored: [], config: [], ...(await this.secretScan(step)) };
    this.emitEvent('log', { level: output.status === 'pass' ? 'info' : 'warn', kind: 'secret_scan', step_id: step.id, status: output.status, message: `${step.id}: ${output.message.split('\n')[0]}` });
    return output;
  },

  async secretScan(step) {
    const given = (key) => render(String(step[key]), this.ctx).trim();
    const skipped = (why) => ({ status: 'skipped', message: `${secretScan.NOT_SCANNED}: ${why}.` });
    const worktree = this.ctx.worktree_dir;
    if (step.enabled != null && /^(off|false|no)$/i.test(given('enabled'))) return skipped('turned off for this run');
    if (!worktree || !fs.existsSync(worktree)) return skipped('the run has no checkout');
    const file = await secretScan.findGitleaks();
    if (!file) return { status: 'skipped', message: secretScan.notInstalledMessage() };
    let dir;
    let range;
    try {
      // gitleaks reads its ignore file and its configuration from the repository's top folder
      dir = await git(['rev-parse', '--show-toplevel'], worktree);
      range = await secretScan.commitRange(dir, step.since != null ? { since: given('since') } : { refs: this.secretScanBase(step.base != null ? given('base') : '') });
    } catch (e) {
      const why = `the run's commits could not be read (${String(e.message).split('\n')[0]})`;
      return this.machine.simulated ? skipped(why) : { status: 'error', message: `${secretScan.NOT_SCANNED}: ${why}.` };
    }
    const env = withCliPath(childEnv(process.env, { passthrough: this.envPassthrough() }));
    const scanned = await secretScan.scanSecrets({ dir, file, range, env, signal: this.abort.signal });
    return { ...scanned, ...(await secretScan.newEntries(dir, range)) };
  },

  // The refs whose commits are not the run's, in groups of alternatives. A Remote run takes the fetched base
  // only (a local one may hold commits that were never pushed), with the parent's branch of a stacked run (#807)
  // and upstream's base of a fork (#738).
  secretScanBase(fallback) {
    const wt = this.worktree;
    const base = wt?.base || fallback;
    if (!base) return [];
    if (!wt?.remote) return [[`refs/heads/${base}`, `refs/remotes/origin/${base}`]];
    const parent = String(this.ctx.inputs?.parent_branch ?? '').trim();
    return [
      [`refs/remotes/origin/${base}`],
      ...(parent ? [[`refs/remotes/origin/${parent}`]] : []),
      ...(wt.fork ? [[`refs/remotes/upstream/${base}`]] : []),
    ];
  },
};

module.exports = {
  methods,
};
