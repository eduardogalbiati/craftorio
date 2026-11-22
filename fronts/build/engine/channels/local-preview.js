// Run locally at a gate (#70): the run's worktree started with the project's command in an embedded
// terminal (term:data / term:exit, see sessions.js), stopped when the gate is answered or the run
// ends. Starting or stopping it never answers the gate. realWorkspace: the copy uses the owner's
// workspace instead of a scratch copy (the UI warns first); it always runs in simulation only.
// Run App (#108): localPreview:info says what the gate's button runs, or a setup suggestion from the
// worktree when nothing is configured; config: a one-off command for a run without a project.
// gate:changes: the files a gate with diff_base changed, for its Artifacts panel.
// #115: localPreview:start's confirm is the owner's one click on a declared or detected command;
// localPreview:save stores the gate's config as the project's (and optionally in the repository's
// .multiagent/local-preview.yaml); localPreview:suggest is what a project's folder runs with (Projects › Edit; SEC-26).

const {
  args,
  BOOL,
  FLAG,
  GATE_ID,
  INT,
  listOf,
  nullable,
  OBJECT,
  RUN_ID,
  shape,
  STRING,
} = require('@craftorio/engine/service/schemas');

const AT_GATE = args({ runId: RUN_ID, approvalId: nullable(GATE_ID) }, ['runId']);
// a one-off or saved command config ({ command, install, url, ... }), checked by packages/engine/domains/local/local-preview.js
const CONFIG = nullable(OBJECT);

module.exports = (ctx) => [
  {
    channel: 'gate:changes',
    method: 'gateChanges',
    params: ['runId', 'approvalId'],
    schema: { params: AT_GATE, result: listOf(shape({ file: STRING, added: nullable(INT), deleted: nullable(INT) }, ['file'])) },
    fn: (opts) => ctx.gateChanges(opts),
  },
  { channel: 'localPreview:info', method: 'localPreviewInfo', params: ['runId', 'approvalId'], schema: { params: AT_GATE, result: OBJECT }, fn: (opts) => ctx.runAppInfo(opts) },
  {
    channel: 'localPreview:start',
    method: 'startLocalPreview',
    params: ['runId', 'approvalId', 'realWorkspace', 'cols', 'rows', 'config', 'confirm'],
    schema: {
      params: args({ runId: RUN_ID, approvalId: nullable(GATE_ID), realWorkspace: FLAG, cols: nullable(INT), rows: nullable(INT), config: CONFIG, confirm: FLAG }, ['runId']),
      result: shape({ id: STRING, title: STRING, url: nullable(STRING), cwd: STRING }, ['id']),
    },
    fn: (opts) => ctx.startLocalPreview(opts),
  },
  { channel: 'localPreview:stop', method: 'stopLocalPreview', params: ['runId'], schema: { params: args({ runId: RUN_ID }, ['runId']), result: BOOL }, fn: ({ runId }) => ctx.stopLocalPreview({ runId }) },
  { channel: 'localPreview:list', method: 'listLocalPreviews', schema: { result: listOf(OBJECT) }, fn: () => ctx.listLocalPreviews() },
  {
    channel: 'localPreview:save',
    method: 'saveLocalPreview',
    params: ['runId', 'approvalId', 'config', 'writeRepoFile'],
    schema: { params: args({ runId: RUN_ID, approvalId: nullable(GATE_ID), config: CONFIG, writeRepoFile: FLAG }, ['runId']), result: shape({ project: OBJECT, config: OBJECT, file: nullable(STRING) }) },
    fn: (opts) => ctx.saveLocalPreview(opts),
  },
  // dir: a project's folder or a run's worktree (Projects › Edit) → its suggested command, or null
  // (any other folder too, SEC-26)
  { channel: 'localPreview:suggest', method: 'suggestLocalPreview', params: ['dir'], schema: { params: args({ dir: STRING }), result: nullable(OBJECT) }, fn: (opts) => ctx.suggestLocalPreview(opts) },
];
