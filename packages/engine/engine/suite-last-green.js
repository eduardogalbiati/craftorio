// Which failures red on the base too a suite round excuses as pre-existing (#527, #736), for
// runSuite (packages/engine/engine/suite-step.js) after its base check (#211):
// - #527: only those a base check confirmed red alone (confirmedOnBase; null: every one);
// - #736: and only those red on the base's last green commit too (lastGreenBase: async () => { dir,
//   commit }, the base health's lastGreen checkout): a failure the current base shares only because an
//   earlier merge turned it red (a size ratchet, a guard) is the run's to fix, so one red merge never
//   lets the next ones through. No last green checkout, or a check that could not run (skipped): the
//   current base decides, as before.
// The last green check's info goes to out.last_green_check. → the failures that stay pre-existing.

'use strict';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// redOnBase: the failures red on the current base; recheck(failures, lastGreenBase) → checkOnBase's
// { onBase, info } in the last green checkout; sameTest(a, b): the same test (suite-step.js).
async function excusedOnBase({ redOnBase, confirmedOnBase, lastGreenBase, recheck, sameTest, out, log = () => {} }) {
  const confirmed = (f) => !Array.isArray(confirmedOnBase) || confirmedOnBase.some((c) => sameTest(f, c));
  const onBase = redOnBase.filter(confirmed);
  const unconfirmed = redOnBase.filter((f) => !onBase.includes(f));
  if (unconfirmed.length) log('info', `suite: ${count(unconfirmed.length, 'failure')} red on the base too but not confirmed by a base check, counted as the run's: ${unconfirmed.map((f) => f.test).join(', ')}`);
  if (!onBase.length || typeof lastGreenBase !== 'function') return onBase;
  let checked;
  try { checked = await recheck(onBase, lastGreenBase); } catch (e) { log('warn', `suite: the last green base check failed (${e.message}): the current base decides`); return onBase; }
  out.last_green_check = checked.info;
  if (checked.info?.status !== 'done') return onBase;
  const back = onBase.filter((f) => !checked.onBase.includes(f));
  const at = checked.info.commit ? ` (${String(checked.info.commit).slice(0, 8)})` : '';
  if (back.length) log('info', `suite: ${count(back.length, 'failure')} red on the base but green on its last green commit${at}, counted as the run's: ${back.map((f) => f.test).join(', ')}`);
  return onBase.filter((f) => checked.onBase.includes(f));
}

module.exports = {
  excusedOnBase,
};
