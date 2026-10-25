// Artifacts screen: documents and files produced by runs (opening one with its app is desktop-only,
// see src/service/manifest.js).

const {
  args,
  FLAG,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  oneOf,
  orNone,
  PROJECT_ID,
  RUN_ID,
  STRING,
  text,
} = require('../schemas');

module.exports = (ctx) => [
  // opts (#200): { runId, q, kind, offset, limit } one run with its artifacts, else { projectId, q, showSim } the runs with counts
  {
    channel: 'artifacts:list',
    method: 'listArtifacts',
    params: ['...opts'],
    schema: {
      params: args({ runId: orNone(RUN_ID), projectId: orNone(PROJECT_ID), q: nullable(text(1000)), kind: nullable(STRING), offset: NUMBER, limit: NUMBER, showSim: FLAG }),
      // the runs (or one run's artifacts), as a list or a page { runs, hiddenSim }
      result: oneOf(listOf(OBJECT), OBJECT),
    },
    fn: (opts) => ctx.artifactRuns(opts || {}),
  },
  // path: an artifact of a run (refused outside the runs' folders)
  { channel: 'artifacts:read', method: 'readArtifact', params: ['path'], schema: { params: args({ path: STRING }, ['path']), result: OBJECT }, fn: (opts) => ctx.readArtifact(opts) },
  // a run's screenshots: the evidence manifest with its final set (#146, src/domains/evidence/evidence.js)
  { channel: 'artifacts:evidence', method: 'runEvidence', params: ['runId'], schema: { params: args({ runId: RUN_ID }), result: nullable(OBJECT) }, fn: (opts) => ctx.runEvidence(opts || {}) },
];
