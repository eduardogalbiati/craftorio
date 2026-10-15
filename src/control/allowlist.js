// The channels the control channel (#336, src/control/index.js) lets an outside session call: reading
// runs, events, roadmaps, the backlog and settings, and the Roadmap screen's actions. Nothing that
// answers, skips or bypasses a human gate (approval:*, gate:*, phonegates:*, runs:resume with
// confirmGate) and nothing that writes settings (it could turn gates or this channel off) belongs
// here: test/control-channel-336.test.js fails when one does. One channel per line, sorted.
// roadmap:item's `park` (#395, Move on) is allowed: the roadmap moves on and the gate keeps waiting,
// unanswered, for the owner.

const CHANNELS = new Set([
  'backlog:get',
  'projects:list',
  'roadmap:cancel-pause',
  'roadmap:get',
  'roadmap:item',
  'roadmap:pause',
  'roadmap:save',
  'roadmap:start',
  'roadmap:undo',
  'roadmap:versions',
  'runs:active',
  'runs:events',
  'runs:list',
  'settings:get',
  'workflows:list',
]);

// Arguments refused even on an allowed channel: they would cross a human gate.
const GATE_ARGS = ['confirmGate'];

module.exports = { CHANNELS, GATE_ARGS };
