// Releases (#260, src/service/areas/releases.js): a project's release history and its next release
// for the Releases screen, the owner's notes of the next release, and the start of a release run.
// Ship itself is the release run's own gate (approval:resolve): no channel here pushes anything.

module.exports = (ctx) => [
  // → { projectId, releases (newest first), next: { version, issues, runs, commits, cost, notes, generated }, line, run }
  { channel: 'releases:list', method: 'listReleases', params: ['projectId'], fn: (opts) => ctx.listReleases(opts) },
  // the next release's notes as the owner edited them (empty: generated again) → the list
  { channel: 'releases:notes', method: 'saveReleaseNotes', params: ['projectId', 'notes'], fn: (opts) => ctx.saveReleaseNotes(opts) },
  // starts the release run (the whole unit and E2E suites, then the Ship gate) → { runId, runDir }
  { channel: 'releases:start', method: 'startRelease', params: ['projectId', 'version', 'simulated'], fn: ({ projectId, version, simulated }) => ctx.startRelease({ projectId, version: version || '', simulated: !!simulated }) },
];
