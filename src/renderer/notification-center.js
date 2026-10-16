/* global api */
// Notification center (#76): the bell in the header (#254, top right) with the unread count, and a panel with the
// history of notifications kept in the workspace index (src/store.js; run started/finished/failed,
// gates waiting or interrupted, CLI sessions waiting, push merge conflicts...). A click on one marks
// it read and opens its run, terminal or project Backlog; "Mark all read" clears the count. The count
// follows 'notifications:changed', pushed by the service, and a desktop notification's click marks
// its row read too. Uses app.js globals ($, esc, openNotificationTarget).

const notificationCenter = { open: false, unread: 0 };

function ncAgo(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { timeZone: TimeZone.current() });
}

function renderNotificationCount(unread) {
  notificationCenter.unread = unread || 0;
  const badge = $('#nav-notifications-count');
  badge.textContent = notificationCenter.unread > 99 ? '99+' : String(notificationCenter.unread);
  badge.classList.toggle('hidden', !notificationCenter.unread);
  $('#nav-notifications').title = notificationCenter.unread ? t('notification_center.unread_unread_notification_value', { unread: notificationCenter.unread, value: notificationCenter.unread === 1 ? '' : 's' }) : t('notification_center.notifications');
}

async function renderNotificationPanel() {
  const list = $('#nc-list');
  try {
    const { items, unread } = await api.listNotifications(100);
    renderNotificationCount(unread);
    list.innerHTML = items.length ? items.map((n) => `
      <button type="button" class="nc-item${n.readAt ? '' : ' unread'}" data-id="${n.id}" data-testid="notification-item">
        <span class="nc-dot" aria-hidden="true"></span>
        <span class="nc-text">
          <b>${esc(n.title)}</b>
          ${n.body ? `<span class="nc-body">${esc(n.body)}</span>` : ''}
          <span class="nc-meta muted small">${esc(ncAgo(n.createdAt))}${n.issue ? ` · ${esc(n.issue)}` : ''}</span>
        </span>
      </button>`).join('') : `<p class="muted small nc-empty">${t('notification_center.no_notifications_yet')}</p>`;
    const byId = new Map(items.map((n) => [String(n.id), n]));
    list.querySelectorAll('.nc-item').forEach((b) => (b.onclick = () => openNotification(byId.get(b.dataset.id))));
  } catch (e) {
    list.innerHTML = `<p class="error small nc-empty">${esc(e?.message || String(e))}</p>`;
  }
}

async function openNotification(n) {
  if (!n) return;
  toggleNotificationCenter(false);
  if (!n.readAt) api.markNotificationsRead([n.id]).then((r) => renderNotificationCount(r.unread)).catch(() => {});
  openNotificationTarget(n.target || {});
}

function toggleNotificationCenter(open = !notificationCenter.open) {
  notificationCenter.open = open;
  $('#notification-center').classList.toggle('hidden', !open);
  $('#nav-notifications').setAttribute('aria-expanded', String(open));
  if (open) renderNotificationPanel();
}

function initNotificationCenter() {
  $('#nav-notifications').onclick = (e) => { e.stopPropagation(); toggleNotificationCenter(); };
  $('#nc-read-all').onclick = async () => {
    const r = await api.markNotificationsRead([]);
    renderNotificationCount(r.unread);
    if (notificationCenter.open) renderNotificationPanel();
  };
  $('#nc-close').onclick = () => toggleNotificationCenter(false);
  document.addEventListener('click', (e) => {
    if (notificationCenter.open && !e.target.closest('#notification-center')) toggleNotificationCenter(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && notificationCenter.open) toggleNotificationCenter(false); });
  api.onNotificationsChange?.(({ unread }) => {
    renderNotificationCount(unread);
    if (notificationCenter.open) renderNotificationPanel();
  });
  // a desktop notification's click opens its run (app.js) and marks its row read here
  api.onNotificationClick?.((target) => {
    if (target?.notificationId) api.markNotificationsRead([target.notificationId]).then((r) => renderNotificationCount(r.unread)).catch(() => {});
  });
  api.listNotifications(1).then((r) => renderNotificationCount(r.unread)).catch(() => {});
}

initNotificationCenter();
