// The channels the control channel (#336, src/control/index.js) lets an outside session call: reading
// runs, events, roadmaps, the backlog and settings, and the Roadmap screen's actions. Nothing that
// answers, skips or bypasses a human gate (approval:*, gate:*, phonegates:*, runs:resume with
// confirmGate) and nothing that writes settings (it could turn gates or this channel off) belongs
// here: test/control-channel-336.test.js fails when one does. One channel per line, sorted.
// roadmap:item's `park` (#395, Move on) is allowed: the roadmap moves on and the gate keeps waiting,
// unanswered, for the owner.
// #399, what the operation sessions need, each still short of a gate:
// - roadmap:pause-stage (#368) only pauses; Resume is roadmap:start. roadmap:park-stage (#395) parks
//   the stage's items at their gates, which keep waiting unanswered, as roadmap:item's `park`.
// - runs:resume without confirmGate: areas/resume.js refuses a resume that would go past a gate the
//   previous run decided, and confirmGate is refused on every channel (GATE_ARGS).
// - workflows:restore: refused through this channel when the workspace copy has a human gate its
//   bundled default lacks (GUARDS['workflows:restore'] in src/control/index.js); the app's Restore button is not.
// - runs:resumeOptions, notifications:list, gates:interrupted, nightwatch:state, nightwatch:report
//   and usage:get only read.
// Left out on purpose: run:stop (at a gate, stopping the run is one of the gate's answers);
// nightwatch:permissions, nightwatch:limits, oracle:act and oracle:nightWatch (they change what
// automation may do on its own); settings:set, approval:*, gate:* and phonegates:* (as above).

const CHANNELS = new Set([
  'backlog:get',
  'gates:interrupted',
  'nightwatch:report',
  'nightwatch:state',
  'notifications:list',
  'projects:list',
  'roadmap:cancel-pause',
  'roadmap:get',
  'roadmap:item',
  'roadmap:park-stage',
  'roadmap:pause',
  'roadmap:pause-stage',
  'roadmap:save',
  'roadmap:start',
  'roadmap:undo',
  'roadmap:versions',
  'runs:active',
  'runs:events',
  'runs:list',
  'runs:resume',
  'runs:resumeOptions',
  'settings:get',
  'usage:get',
  'workflows:list',
  'workflows:restore',
]);

// Arguments refused even on an allowed channel: they would cross a human gate.
const GATE_ARGS = ['confirmGate'];

module.exports = { CHANNELS, GATE_ARGS };
