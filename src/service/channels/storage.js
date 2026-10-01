// The workspace's index (src/store.js, #76): the notification center (history, unread count, mark
// as read; 'notifications:changed' is pushed on each new one), the gates of runs that did not
// survive a restart, and Settings' index status and "Rebuild index" (the runs cache, from runs/).

const runs = require('../../runs');

const noIndex = (ctx) => new Error(`The workspace index is not available${ctx.storeError ? `: ${ctx.storeError}` : '.'}`);

module.exports = (ctx) => [
  // { items: newest first, unread }; unread: true lists only the unread ones
  {
    channel: 'notifications:list',
    method: 'listNotifications',
    params: ['limit', 'unread'],
    fn: (opts) => (ctx.store ? { items: ctx.store.notifications({ limit: opts?.limit, unread: !!opts?.unread }), unread: ctx.store.unreadCount() } : { items: [], unread: 0 }),
  },
  // ids: the notifications to mark read (none: all of them); returns the unread count left
  {
    channel: 'notifications:read',
    method: 'markNotificationsRead',
    params: ['ids'],
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
  { channel: 'gates:interrupted', method: 'interruptedGates', fn: () => (ctx.store ? ctx.store.gates({ state: 'interrupted', limit: 50 }) : []) },
  // where the index is and whether it is open (Settings › Folders)
  {
    channel: 'index:status',
    method: 'indexStatus',
    fn: () => ({ path: ctx.ws.index, open: !!ctx.store, error: ctx.storeError || null, runs: ctx.store ? ctx.store.runRows().length : 0 }),
  },
  // the runs cache emptied and read again from runs/ (the files are the source of truth)
  {
    channel: 'index:rebuild',
    method: 'rebuildIndex',
    fn: () => {
      if (!ctx.store) throw noIndex(ctx);
      return { path: ctx.ws.index, runs: runs.rebuildIndex(ctx.ws.runs) };
    },
  },
];
