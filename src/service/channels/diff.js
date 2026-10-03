// The diff viewer (#118, areas/diff.js): run:diff lists a run's changed files with their patches
// (the whole branch since the merge base with its base, or one commit), run:diffFile one file's
// patch and both sides (context expansion, a huge file's "load diff", image previews). Read-only.

module.exports = (ctx) => [
  { channel: 'run:diff', method: 'runDiff', params: ['runId', 'approvalId', 'commit'], fn: (opts) => ctx.runDiff(opts) },
  { channel: 'run:diffFile', method: 'runDiffFile', params: ['runId', 'approvalId', 'commit', 'file', 'oldFile'], fn: (opts) => ctx.runDiffFile(opts) },
];
