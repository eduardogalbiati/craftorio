// The Monitor's channels (#634, spec R12): the Errors screen's end (fronts/ai/views/errors/) of the
// Monitor area (packages/engine/fronts/ai/areas/monitor.js): the project's error groups with their state, its
// sources (a token goes to the system keychain, never back), a poll now, a group's diagnosis into an
// Inbox intent, the automation (ask | on | off, a daily cap) and "Propose fix" (the `fix` workflow,
// stopping at its human gate). Every channel takes one object (`params: 'opts'`), the way the view
// calls them (`api.monitorState({ projectId })`).

const { requireObject } = require('@craftorio/engine/service/common');
const {
  ANY,
  args,
  BOOL,
  INT,
  listOf,
  nullable,
  OBJECT,
  PROJECT_ID,
  shape,
  STRING,
  text,
} = require('@craftorio/engine/service/schemas');

const onProject = (properties = {}, required = []) => args({ projectId: PROJECT_ID, ...properties }, ['projectId', ...required]);
const FINGERPRINT = text(64);
const ON_GROUP = onProject({ fingerprint: FINGERPRINT }, ['fingerprint']);
const GROUP = shape({ fingerprint: STRING, title: STRING, status: ANY, message: STRING, where: nullable(STRING), count: INT, firstSeen: nullable(STRING), lastSeen: nullable(STRING), spark: listOf(INT), state: STRING, cardId: nullable(STRING), runId: nullable(STRING) }, ['fingerprint', 'title', 'state']);
const SOURCE = shape({ id: STRING, type: STRING, label: STRING, hasToken: BOOL }, ['id', 'type']);
const AUTOMATION = shape({ diagnose: STRING, fix: STRING, dailyCap: INT }, ['diagnose', 'fix', 'dailyCap']);

module.exports = (ctx) => [
  // { projectId } → { groups (count first, each with state new | intent | fix-run), sources (no token), automation }
  {
    channel: 'monitor:state',
    method: 'monitorState',
    params: 'opts',
    schema: { params: onProject(), result: shape({ groups: listOf(GROUP), sources: listOf(SOURCE), automation: AUTOMATION, webhook: shape({ enabled: BOOL }, ['enabled']) }, ['groups', 'sources', 'automation']) },
    fn: async (arg) => ctx.monitorState(requireObject(arg, 'options')),
  },
  // { projectId, source: { type, label?, path | url | org + project, token? } } → { ok, source } (never the token)
  {
    channel: 'monitor:save-source',
    method: 'monitorSaveSource',
    params: 'opts',
    schema: { params: onProject({ source: OBJECT }, ['source']), result: shape({ ok: BOOL, error: nullable(STRING), source: nullable(OBJECT) }, ['ok']) },
    fn: async (arg) => ctx.monitorSaveSource(requireObject(arg, 'options')),
  },
  // { projectId } → { ok, groups, errors }: every source polled now, its events deduplicated by id
  {
    channel: 'monitor:poll',
    method: 'monitorPoll',
    params: 'opts',
    schema: { params: onProject(), result: shape({ ok: BOOL, groups: listOf(GROUP), errors: listOf(STRING) }, ['ok']) },
    fn: async (arg) => ctx.monitorPoll(requireObject(arg, 'options')),
  },
  // { projectId, fingerprint, item? } → { ok, cardId, intent? }: the group's intent card in the Inbox, once per
  // group; #650 with `item` (a work item of docs/work) also the incident in its maintain.md and a new intent
  {
    channel: 'monitor:diagnose',
    method: 'monitorDiagnose',
    params: 'opts',
    schema: { params: onProject({ fingerprint: FINGERPRINT, item: nullable(text(100)) }, ['fingerprint']), result: shape({ ok: BOOL, error: nullable(STRING), cardId: nullable(STRING), existing: ANY, intent: nullable(OBJECT) }, ['ok']) },
    fn: async (arg) => ctx.monitorDiagnose(requireObject(arg, 'options')),
  },
  // { projectId, diagnose, fix, dailyCap } → { ok, automation } or { ok: false, error } (nothing saved)
  {
    channel: 'monitor:automation',
    method: 'monitorAutomation',
    params: 'opts',
    schema: { params: onProject({ diagnose: STRING, fix: STRING, dailyCap: ANY }), result: shape({ ok: BOOL, error: nullable(STRING), automation: nullable(AUTOMATION) }, ['ok']) },
    fn: (arg) => ctx.monitorSetAutomation(requireObject(arg, 'options')),
  },
  // { projectId, fingerprint } → { ok, runId }: the `fix` workflow on the group's diagnosis, waiting at its gate
  {
    channel: 'monitor:propose-fix',
    method: 'monitorProposeFix',
    params: 'opts',
    schema: { params: ON_GROUP, result: shape({ ok: BOOL, error: nullable(STRING), runId: nullable(STRING), existing: ANY }, ['ok']) },
    fn: async (arg) => ctx.monitorProposeFix(requireObject(arg, 'options')),
  },
  // { projectId, enable } → { ok, enabled, path }: the webhook on (a new key in the keychain; `path`, the
  // engine server's POST /hooks/monitor/<project>?key=…, is shown this once) or off (no key)
  {
    channel: 'monitor:webhook',
    method: 'monitorWebhook',
    params: 'opts',
    schema: { params: onProject({ enable: BOOL }, ['enable']), result: shape({ ok: BOOL, enabled: BOOL, path: nullable(STRING) }, ['ok', 'enabled']) },
    fn: async (arg) => ctx.monitorWebhook(requireObject(arg, 'options')),
  },
];
