// The workspace's index (src/store.js, #76): the notification center (history, unread count, mark
// as read; 'notifications:changed' is pushed on each new one), the gates of runs that did not
// survive a restart, and Settings' index status and "Rebuild index" (the runs cache, from runs/).
// Also the dependency cache's size and "Clear dependency cache" (#198).

const path = require('path');
const depsCache = require('../../engine/deps-cache');
const runs = require('../../runs');
const {
  ANY,
  args,
  BOOL,
  FLAG,
  INT,
  listOf,
  nullable,
  NUMBER,
  OBJECT,
  shape,
  STRING,
} = require('../schemas');

const noIndex = (ctx) => new Error(`The workspace index is not available${ctx.storeError ? `: ${ctx.storeError}` : '.'}`);

const UNREAD = INT;
const CACHE_INFO = shape({ dir: STRING, entries: ANY, bytes: NUMBER, linked: ANY }, ['dir']);

module.exports = (ctx) => [
  // { items: newest first, unread }; unread: true lists only the unread ones
  {
    channel: 'notifications:list',
    method: 'listNotifications',
    params: ['limit', 'unread'],
    schema: { params: args({ limit: nullable(INT), unread: FLAG }), result: shape({ items: listOf(OBJECT), unread: UNREAD }, ['items', 'unread']) },
    fn: (opts) => (ctx.store ? { items: ctx.store.notifications({ limit: opts?.limit, unread: !!opts?.unread }), unread: ctx.store.unreadCount() } : { items: [], unread: 0 }),
  },
  // ids: the notifications to mark read (none: all of them); returns the unread count left
  {
    channel: 'notifications:read',
    method: 'markNotificationsRead',
    params: ['ids'],
    schema: { params: args({ ids: nullable(listOf({ type: ['integer', 'string'] })) }), result: shape({ unread: UNREAD }, ['unread']) },
    fn: (opts) => {
      if (!ctx.store) return { unread: 0 };
      const ids = Array.isArray(opts?.ids) ? opts.ids.map(Number).filter(Number.isFinite) : [];
      ctx.store.markRead(ids);
      const unread = ctx.store.unreadCount();
      ctx.events.emit('notifications:changed', { unread, latest: null });
      return { unread };
    },
  },
  { event: 'notifications:changed', method: 'onNotificationsChange' },
  // gates whose run did not survive a restart ({ runId, approvalId, stepId, message, requestedAt, closedAt })
  { channel: 'gates:interrupted', method: 'interruptedGates', schema: { result: listOf(OBJECT) }, fn: () => (ctx.store ? ctx.store.gates({ state: 'interrupted', limit: 50 }) : []) },
  // where the index is and whether it is open (Settings › Folders)
  {
    channel: 'index:status',
    method: 'indexStatus',
    schema: { result: shape({ path: STRING, open: BOOL, error: nullable(STRING), runs: INT }, ['open', 'runs']) },
    fn: () => ({ path: ctx.ws.index, open: !!ctx.store, error: ctx.storeError || null, runs: ctx.store ? ctx.store.runRows().length : 0 }),
  },
  // the runs cache emptied and read again from runs/ (the files are the source of truth)
  {
    channel: 'index:rebuild',
    method: 'rebuildIndex',
    schema: { result: shape({ path: STRING, runs: ANY }) },
    fn: () => {
      if (!ctx.store) throw noIndex(ctx);
      return { path: ctx.ws.index, runs: runs.rebuildIndex(ctx.ws.runs) };
    },
  },
  // the dependency cache (#198, src/engine/deps-cache.js): { dir, entries, bytes, linked } for Settings
  { channel: 'depsCache:info', method: 'depsCacheInfo', schema: { result: CACHE_INFO }, fn: () => depsCache.cacheInfo(path.join(ctx.ws.cache, 'deps')) },
  // Clear dependency cache: every entry no worktree links (the linked ones stay); { removed, freedBytes, kept, ...info }
  {
    channel: 'depsCache:clear',
    method: 'clearDepsCache',
    schema: { result: { ...CACHE_INFO, properties: { ...CACHE_INFO.properties, removed: INT, freedBytes: NUMBER, kept: ANY } } },
    fn: () => {
      const dir = path.join(ctx.ws.cache, 'deps');
      const r = depsCache.pruneDepsCache({ cacheDir: dir, maxAgeDays: 0 });
      return { removed: r.removed.length, freedBytes: r.freedBytes, kept: r.kept, ...depsCache.cacheInfo(dir) };
    },
  },
];
