// Releases (#260, src/service/areas/releases.js): a project's release history and its next release
// for the Releases screen, the owner's notes of the next release, and the start of a release run.
// Ship itself is the release run's own gate (approval:resolve): no channel here pushes anything.

const {
  ANY,
  args,
  FLAG,
  listOf,
  nullable,
  OBJECT,
  orNone,
  PROJECT_ID,
  shape,
  STARTED,
  STRING,
  text,
} = require('../schemas');

const VERSION = nullable(text(100));
const RELEASES = shape({ projectId: nullable(PROJECT_ID), releases: listOf(OBJECT), next: nullable(OBJECT), line: ANY, run: nullable(OBJECT) }, ['releases']);

module.exports = (ctx) => [
  // → { projectId, releases (newest first), next: { version, issues, runs, commits, cost, notes, generated }, line, run };
  // without a project, an empty history
  { channel: 'releases:list', method: 'listReleases', params: ['projectId'], schema: { params: args({ projectId: orNone(PROJECT_ID) }), result: RELEASES }, fn: (opts) => ctx.listReleases(opts) },
  // a shipped release's summary, written by its release run (#290) → { version, runId, text }
  {
    channel: 'releases:summary',
    method: 'readReleaseSummary',
    params: ['projectId', 'version'],
    schema: { params: args({ projectId: PROJECT_ID, version: VERSION }, ['projectId']), result: shape({ version: STRING, runId: nullable(STRING), text: nullable(STRING) }) },
    fn: (opts) => ctx.readReleaseSummary(opts),
  },
  // the next release's notes as the owner edited them (empty: generated again) → the list
  { channel: 'releases:notes', method: 'saveReleaseNotes', params: ['projectId', 'notes'], schema: { params: args({ projectId: PROJECT_ID, notes: nullable(STRING) }, ['projectId']), result: RELEASES }, fn: (opts) => ctx.saveReleaseNotes(opts) },
  // starts the release run (the whole unit and E2E suites, then the Ship gate) → { runId, runDir }
  {
    channel: 'releases:start',
    method: 'startRelease',
    params: ['projectId', 'version', 'simulated'],
    schema: { params: args({ projectId: PROJECT_ID, version: VERSION, simulated: FLAG }, ['projectId']), result: STARTED },
    fn: ({ projectId, version, simulated }) => ctx.startRelease({ projectId, version: version || '', simulated: !!simulated }),
  },
];
