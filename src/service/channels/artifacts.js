// Artifacts screen: documents and files produced by runs (opening one with its app is desktop-only,
// see src/service/manifest.js).

module.exports = (ctx) => [
  { channel: 'artifacts:list', method: 'listArtifacts', params: ['...opts'], fn: (opts) => ctx.artifactRuns(opts || {}) },
  { channel: 'artifacts:read', method: 'readArtifact', params: ['path'], fn: (opts) => ctx.readArtifact(opts) },
];
