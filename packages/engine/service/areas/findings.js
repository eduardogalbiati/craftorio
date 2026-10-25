// Findings (#361), what the service adds to a finding: the last 50 channel calls (recordCall wraps
// every channel in packages/engine/service/index.js; the channel, ok, its error and duration, never its
// arguments or its answer) and the app's version and commit. Channels: channels/findings.js.
const { execFileSync } = require('child_process');
const path = require('path');
const { remember } = require('@multiagent/shared/findings-model');

const MAX_CALLS = 50;
const { appRoot } = require('../../domains/workspace/app-root');

const APP_DIR = appRoot();

module.exports = (ctx) => {
  const calls = [];
  let commit;

  const record = (channel, started, error) => {
    remember(calls, { channel, ok: !error, error: error ? String(error.message || error) : null, ms: Date.now() - started, at: started }, MAX_CALLS);
  };

  return {
    /** Runs a channel's handler and records the call (sync or async); its result or error is unchanged. */
    recordCall(channel, run) {
      const started = Date.now();
      let out;
      try {
        out = run();
      } catch (e) {
        record(channel, started, e);
        throw e;
      }
      if (!out || typeof out.then !== 'function') {
        record(channel, started, null);
        return out;
      }
      return out.then(
        (value) => { record(channel, started, null); return value; },
        (e) => { record(channel, started, e); throw e; },
      );
    },
    recentCalls: () => calls.slice(),
    // the commit the app runs from source (git), the source hash when packaged or without git
    appBuild() {
      if (commit === undefined) {
        commit = null;
        if (!ctx.host.isPackaged) {
          try {
            commit = execFileSync('git', ['-C', APP_DIR, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).trim() || null;
          } catch {
            // not a git checkout
          }
        }
      }
      return { version: ctx.host.appVersion || null, commit: commit || ctx.code?.check?.().running || null };
    },
  };
};
