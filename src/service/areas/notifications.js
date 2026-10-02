// Service area: desktop notifications and the notification center (src/notifications.js). Every
// notice is a row of the index's notification center (whatever the settings say about showing it
// on the desktop) and is emitted on 'notify' when the settings and what the window shows
// (uiContext: { focused, runId, terminalId, poProjectId }, reported by the UI) let it through.

const workspace = require('../../workspace');
const notifier = require('../../notifications');

module.exports = (ctx) => {
  let uiContext = notifier.normalizeContext(null);

  // `extra`: { projectId, issue } of its run. The desktop notice carries the row's id in its
  // target, so a click on it marks it read.
  function notify(notice, extra = {}) {
    if (!notice) return;
    let settings = {};
    try { if (ctx.ws) settings = workspace.readSettings(ctx.ws); } catch { /* defaults */ }
    let shown = notice;
    const { store } = ctx;
    if (store) {
      try {
        const row = store.addNotification({
          type: `${notice.kind}.${notice.event}`, kind: notice.kind, runId: notice.target?.runId || null,
          projectId: extra.projectId || null, issue: extra.issue || null, title: notice.title, body: notice.body, target: notice.target || null,
        });
        store.pruneNotifications(settings.notificationRetentionDays ?? workspace.DEFAULT_SETTINGS.notificationRetentionDays);
        shown = { ...notice, target: { ...notice.target, notificationId: row.id } };
        ctx.events.emit('notifications:changed', { unread: store.unreadCount(), latest: row });
      } catch (e) { console.error('notification center:', e.message); }
    }
    if (notifier.shouldNotify(notice, { settings, context: uiContext })) ctx.events.emit('notify', shown);
  }

  return {
    notify,
    setUiContext: (c) => { uiContext = notifier.normalizeContext(c); },
  };
};
