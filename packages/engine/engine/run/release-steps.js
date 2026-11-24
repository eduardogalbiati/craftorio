// @ts-check
// `type: release_version` (#325, #46): a release run's version, written and committed before its suites
// (`runReleaseVersionStep`; `runProductVersion` for a product the repository declares), and the tag before
// the release (`previousReleaseTag`, #378). packages/engine/domains/releases/releases.js does the work,
// through the run's machine adapter (`this.machine`, #353).

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const { previousTag } = require('../../domains/releases/release-city');
const {
  productOf,
  releaseSemver,
} = require('../../domains/releases/releases');
const { render } = require('./templates');

// #378: the tag before the release `version` (release.yaml's `previous_version` output, the `since`
// a refactor-proposals stage reads), as the Release city tab names it (packages/engine/domains/releases/release-city.js
// previousTag: semver order for a semver name, even before Ship tags it); a name that is not a
// semver and not tagged yet: the newest tag reachable from HEAD. '' without a git checkout or a tag
async function previousReleaseTag(dir, version) {
  if (!dir || !fs.existsSync(dir)) return '';
  const tag = await previousTag(dir, version);
  if (tag || releaseSemver(version)) return tag || '';
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'HEAD'], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const methods = {
  // `type: release_version` (#325, release.yaml before the suites): the release's version written into
  // the project's package.json and committed on the run's branch (packages/engine/domains/releases/releases.js writeReleaseVersion).
  // Never fails the run: a name that is not a semver, no package.json, nothing to change or a git
  // error is said in the output and the log. Only in the run's own worktree (never the owner's
  // checkout); a simulation writes nothing and says what it would set.
  // #46: a repository that declares products releases one (`product`): its own version command, tag and
  // last release, and what cannot be released stops the run here (runProductVersion throws).
  async runReleaseVersionStep(step) {
    const dir = render(String(step.dir ?? '{{ worktree_dir }}'), this.ctx).trim();
    const version = render(String(step.version ?? ''), this.ctx).trim();
    const branch = step.branch ? render(String(step.branch), this.ctx).trim() : null;
    const asked = render(String(step.product ?? ''), this.ctx).trim();
    const product = productOf(dir, asked);
    if (product) return this.runProductVersion(step, { dir, product, version, branch });
    if (asked) this.emitEvent('log', { level: 'warn', kind: 'release_version', step_id: step.id, message: `${step.id}: the repository declares no products: the product ${asked} is ignored` });
    const none = (reason) => ({ written: false, from: null, to: null, files: [], commit: null, reason });
    let r;
    let error = false;
    const simulated = this.machine.simulated;
    try {
      r = !simulated && !this.worktree
        ? none('The run has no worktree of its own: the version is not written in the repository folder.')
        : await this.machine.writeReleaseVersion({ dir, version, branch });
    } catch (e) {
      error = true;
      r = none(`The version could not be written: ${e.message}`);
    }
    // what ships with the release (a simulation: what a real run would write)
    const change = r.written || (simulated && r.files.length) ?`package.json ${r.from || '(no version)'} → ${r.to}` : '';
    const output = { kind: 'release_version', status: r.written ? 'written' : 'unchanged', version, ...r, change, previous_version: await previousReleaseTag(dir, version), message: r.reason };
    this.emitEvent('log', { level: error ? 'warn' : 'info', kind: 'release_version', step_id: step.id, message: `${step.id}: ${r.reason}` });
    return output;
  },

  // #46: the version of the chosen product (packages/engine/domains/releases/releases.js writeProductVersion), the
  // tag Ship makes and its merged issues with no changeset, said in the log before the suites.
  async runProductVersion(step, { dir, product, version, branch }) {
    if (!this.machine.simulated && !this.worktree) throw new Error(`The run has no worktree of its own: the version of ${product.id} is not written in the repository folder.`);
    const { reason, ...r } = await this.machine.writeProductVersion({ dir, product, version, branch, passthrough: this.envPassthrough() });
    const log = (level, message) => this.emitEvent('log', { level, kind: 'release_version', step_id: step.id, message: `${step.id}: ${message}` });
    log('info', reason);
    const missing = r.missing_changesets.map((n) => `#${n}`).join(', ');
    if (missing) log('warn', `Merged issues of ${product.id} with no changeset${r.previous_version ? ` since ${r.previous_version}` : ''}: ${missing}`);
    return { kind: 'release_version', status: r.written ? 'written' : 'unchanged', version, ...r, message: reason };
  },
};

module.exports = {
  methods,
};
