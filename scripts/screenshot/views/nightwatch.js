// Screenshot seed of the Night watch (--view nightwatch, #172): two replayed nights from
// src/night-watch-demo.js (writeNights, also Home's morning summary); --mode self-healing (#278):
// Self-healing on since yesterday ("Self-healing is on" in place of the end time, its days in the
// report), the switch itself a setting (Settings › Execution › Oracle).

// The nights (an app before the Night watch: nothing), and with selfHealing its setting on.
function writeNights({ ws, project, src, workspace }, { selfHealing = false } = {}) {
  try { src('night-watch-demo').writeDemoNights(ws, project.id, { selfHealing }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  if (selfHealing) workspace.writeSettings(ws, { oracle: { ...workspace.readSettings(ws).oracle, selfHealing: true } });
}

const seed = (ctx) => writeNights(ctx, { selfHealing: ctx.args.mode === 'self-healing' });

module.exports = {
  modes: ['self-healing'],
  seed,
  writeNights,
};
