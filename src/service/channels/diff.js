// The diff viewer (#118, areas/diff.js): run:diff lists a run's changed files with their patches
// (the whole branch since the merge base with its base, or one commit), run:diffFile one file's
// patch and both sides (context expansion, a huge file's "load diff", image previews). Read-only.
// run:diff's `summary` (#289, the expanded run card's Repository column): the commits and the files'
// counts without any patch.

const {
  args,
  FLAG,
  GATE_ID,
  nullable,
  OBJECT,
  RUN_ID,
  STRING,
} = require('../schemas');

const COMMIT = nullable(STRING);

module.exports = (ctx) => [
  {
    channel: 'run:diff',
    method: 'runDiff',
    params: ['runId', 'approvalId', 'commit', 'summary'],
    schema: { params: args({ runId: RUN_ID, approvalId: nullable(GATE_ID), commit: COMMIT, summary: FLAG }, ['runId']), result: OBJECT },
    fn: (opts) => ctx.runDiff(opts),
  },
  {
    channel: 'run:diffFile',
    method: 'runDiffFile',
    params: ['runId', 'approvalId', 'commit', 'file', 'oldFile'],
    schema: { params: args({ runId: RUN_ID, approvalId: nullable(GATE_ID), commit: COMMIT, file: STRING, oldFile: nullable(STRING) }, ['runId']), result: OBJECT },
    fn: (opts) => ctx.runDiffFile(opts),
  },
];
