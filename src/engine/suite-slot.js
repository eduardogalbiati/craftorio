// One whole suite at a time per machine (#455): a whole-suite round of the suite step (suite-step.js
// runSuite's `slot`) waits for the machine-wide `suite` slot (machine-slot.js) before its command and
// frees it when the command ends, however it ends; the command's child inherits it (SUITE_SLOT_ENV).
// A focused (`files`) or simulated round never takes it. `suiteSlotRun` returns the `run` to call.

const fs = require('fs');
const {
  acquireSlot,
  SUITE_MAX_HOLD_MS,
  SUITE_SLOT,
  SUITE_SLOT_ENV,
} = require('./machine-slot');

// slot: { dir, holder, onWait(holder), pollMs }; the wait ends with the signal (throws 'Cancelled').
// #465: the wait is written to the round's log when it starts (its live terminal shows it).
async function suiteSlotRun({ slot, mock, scope, signal, logFile, run }) {
  if (mock || !slot || scope === 'files') return run;
  let said = false;
  const onWait = (holder) => {
    if (logFile && !said) {
      said = true;
      try { fs.appendFileSync(logFile, `# waiting for the suite slot (run ${holder?.holder || '?'}, pid ${holder?.pid ?? '?'})\n`); } catch { /* the log is a convenience */ }
    }
    slot.onWait?.(holder);
  };
  const held = await acquireSlot(SUITE_SLOT, {
    dir: slot.dir, holder: slot.holder, onWait, pollMs: slot.pollMs, signal, waitMs: 2 * SUITE_MAX_HOLD_MS,
  });
  if (held.waitedMs >= 1000 && logFile) fs.appendFileSync(logFile, `# waited ${Math.round(held.waitedMs / 1000)} s for the suite slot\n`);
  return async (opts) => {
    try {
      return await run({ ...opts, env: { ...opts.env, [SUITE_SLOT_ENV]: held.token } });
    } finally {
      held.release();
    }
  };
}

module.exports = {
  suiteSlotRun,
};
