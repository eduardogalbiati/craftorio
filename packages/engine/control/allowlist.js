// The channels the control channel (#336, packages/engine/control/index.js) lets an outside session call: reading
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
//   previous run decided, and confirmGate is refused on every channel (GATE_ARGS). Without inputs
//   too (#799, GUARDS['runs:resume'] in packages/engine/control/index.js): only the owner changes them.
// - workflows:restore: refused through this channel when the workspace copy has a human gate its
//   bundled default lacks (GUARDS['workflows:restore'] in packages/engine/control/index.js); the app's Restore button is not.
// - runs:resumeOptions, notifications:list, gates:interrupted, nightwatch:state, nightwatch:report
//   and usage:get only read.
// #42 (the owner's decision, 2026-11-24), so a session takes a project from zero to a running roadmap; the agents of
// a run can read the endpoint's token, so they can call these too (the accepted risk):
// - projects:create imports a folder or clones a repository; no project is changed or removed.
// - backlog:sync only reads the platform (gh, glab, a git fetch).
// - backlog:create-issue writes only the local backlog of a project with no remote (#35): with a remote it is
//   refused (GUARDS['backlog:create-issue'] in packages/engine/control/index.js), nothing is filed on GitHub or GitLab.
// Left out on purpose: run:stop (at a gate, stopping the run is one of the gate's answers);
// nightwatch:permissions, nightwatch:limits, oracle:act and oracle:nightWatch (they change what
// automation may do on its own); settings:set, approval:*, gate:* and phonegates:* (as above).

const CHANNELS = new Set([
  'backlog:create-issue',
  'backlog:get',
  'backlog:sync',
  'gates:interrupted',
  'nightwatch:report',
  'nightwatch:state',
  'notifications:list',
  'projects:create',
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
