// Screenshot seed of the Night watch (--view nightwatch, #172): two replayed nights from
// src/domains/night/night-watch-demo.js (writeNights, also Home's morning summary); --mode self-healing (#278):
// Self-healing on since yesterday ("Self-healing is on" in place of the end time, its days in the
// report), the switch itself a setting (Settings › Execution › Oracle).
// #337 Limits tonight: the demo has no nightly budget (the turn-on form's warning: --click "#nw-switch"
// --click "#nw-limits-expand", customized: also --click "#nw-limits-customize"); --mode budget: a
// nightly budget of US$ 75 (the summary's "nightly budget US$ 150"); --mode limits: the watch on for
// 6 more hours with every limit ×2 (the limits in force, changeable). Last night's morning summary
// lists a run past a day limit (#14: context 58M of 80M tonight).

const fs = require('fs');
const path = require('path');

// The nights (an app before the Night watch: nothing), and with selfHealing its setting on;
// regressions (#335, Home): a step's run history whose last runs cost more.
function writeNights({ ws, project, src, workspace }, { selfHealing = false, regressions = false } = {}) {
  try { src('domains/night/night-watch-demo').writeDemoNights(ws, project.id, { selfHealing, regressions }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  if (selfHealing) workspace.writeSettings(ws, { oracle: { ...workspace.readSettings(ws).oracle, selfHealing: true } });
}

// #337: a nightly budget, and with `on` the Night watch on now with every limit ×2
function writeLimits({ ws, workspace }, { on = false } = {}) {
  workspace.writeSettings(ws, { budget: { ...(workspace.readSettings(ws).budget || {}), nightlyUsd: 75 } });
  if (!on) return;
  const dir = ws.oracle || path.join(ws.root, 'oracle');
  const startedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'night-watch.json'), JSON.stringify({ on: true, until: new Date(Date.now() + 6 * 3600e3).toISOString(), startedAt, by: 'the owner' }, null, 2));
  fs.writeFileSync(path.join(dir, 'night-limits.json'), JSON.stringify({ multiplier: 2, night: startedAt, by: 'the owner', at: startedAt }, null, 2));
}

function seed(ctx) {
  writeNights(ctx, { selfHealing: ctx.args.mode === 'self-healing' });
  if (ctx.args.mode === 'budget' || ctx.args.mode === 'limits') writeLimits(ctx, { on: ctx.args.mode === 'limits' });
}

module.exports = {
  modes: ['budget', 'limits', 'self-healing'],
  seed,
  writeNights,
};
