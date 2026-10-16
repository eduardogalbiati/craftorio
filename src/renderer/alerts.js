// Page alerts (#270): the shared component for what a page has to tell its owner, at the top of the
// page (above its filter row), one alert at a time with a counter ("1/3") and previous / next arrows.
// An alert: { id, level: 'info' | 'warning' | 'error', title, text, actions: [{ label, onClick,
// primary, title?, pressed? (a switch: true / false), attrs? (extra attributes, e.g. a data-testid) }],
// dismissible, onDismiss?, createdAt? }. Errors come first, then warnings, then infos, the oldest
// first within a level (the given order without `createdAt`). Colours follow the level (info light
// blue, warning amber, error red, each with its icon); an error is role="alert", the others
// role="status". × (info and warning only: an error stays while its cause does) hides the alert until
// its condition clears; the page calls set() on every render, so an alert whose condition cleared
// leaves by itself. The component knows no screen: a page builds its own list and mounts it
// (`Alerts.mount(box).set(list)`; docs/agents/renderer.md, "Page alerts").
// Browser: window.Alerts; Node: module.exports (test/renderer-alerts-270.test.js).
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const LEVELS = ['error', 'warning', 'info'];
  const ICON = {
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.2" /></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.3v.2" /></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.2" /></svg>',
  };
  const ARROW = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>',
  };
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const levelOf = (a) => (LEVELS.includes(a?.level) ? a.level : 'info');
  const age = (a) => { const t = Date.parse(a?.createdAt); return Number.isNaN(t) ? Infinity : t; };

  /** A new list: errors, warnings, infos; the oldest first within a level (else the given order). */
  function sortAlerts(alerts) {
    return (alerts || []).map((a, n) => [a, n])
      .sort(([a, n], [b, m]) => LEVELS.indexOf(levelOf(a)) - LEVELS.indexOf(levelOf(b)) || age(a) - age(b) || n - m)
      .map(([a]) => a);
  }

  function actionHtml(a, action, n) {
    const toggle = typeof action.pressed === 'boolean';
    const attrs = Object.entries(action.attrs || {}).map(([k, v]) => ` ${escHtml(k)}="${escHtml(v)}"`).join('');
    return `<button type="button" class="btn sm ${action.primary ? 'primary' : 'ghost'}${toggle ? ' alert-switch' : ''}" data-alert="${escHtml(a.id)}" data-alert-action="${n}"${toggle ? ` role="switch" aria-checked="${action.pressed}"` : ''}${action.title ? ` title="${escHtml(action.title)}"` : ''}${attrs}>${escHtml(action.label)}</button>`;
  }

  /** The markup of the alert at `index` of the sorted list, with the counter and arrows (several alerts); '' without alerts. */
  function alertsHtml(alerts, index = 0) {
    const list = sortAlerts(alerts);
    if (!list.length) return '';
    const at = Math.min(Math.max(0, Number(index) || 0), list.length - 1);
    const a = list[at];
    const level = levelOf(a);
    const nav = (dir, label) => `<button type="button" class="icon-btn" data-alert-nav="${dir}" aria-label="${label}" title="${label}">${ARROW[dir]}</button>`;
    return `<div class="page-alerts" data-testid="page-alerts">
      <div class="alert alert-${level}" role="${level === 'error' ? 'alert' : 'status'}" data-testid="page-alert" data-level="${level}">
        <span class="alert-icon" aria-hidden="true">${ICON[level]}</span>
        <div class="alert-body"><b class="alert-title">${escHtml(a.title)}</b>${a.text ? `<span class="alert-text">${escHtml(a.text)}</span>` : ''}</div>
        <div class="alert-actions">${(a.actions || []).map((action, n) => actionHtml(a, action, n)).join('')}</div>
        ${list.length > 1 ? `<span class="alerts-nav">${nav('prev', 'Previous alert')}<span class="alerts-count" data-testid="alerts-counter">${at + 1}/${list.length}</span>${nav('next', 'Next alert')}</span>` : ''}
        ${a.dismissible && level !== 'error' ? `<button type="button" class="icon-btn alert-close" data-alert-dismiss="${escHtml(a.id)}" aria-label="${t('common.dismiss')}" title="${t('alerts.dismiss_it_comes_back_when_it')}">×</button>` : ''}
      </div>
    </div>`;
  }

  /**
   * The alerts of a page in `container`: set(alerts) draws them (the alert shown stays the shown one
   * while it is there, else the first). Clicks are delegated: the arrows, an action, ×.
   */
  function mount(container) {
    let list = [];
    let shownId = null;
    let drawn = null;
    const dismissed = new Set();
    const shown = () => sortAlerts(list.filter((a) => !dismissed.has(String(a.id))));
    function draw() {
      const all = shown();
      const at = Math.max(0, all.findIndex((a) => a.id === shownId));
      shownId = all[at]?.id ?? null;
      const html = alertsHtml(all, at);
      container.classList?.toggle('hidden', !html);
      // unchanged markup is left alone: the focus stays on its button and an error is not announced again
      if (html !== drawn) { container.innerHTML = html; drawn = html; }
    }
    container.onclick = (e) => {
      const nav = e.target.closest?.('[data-alert-nav]');
      if (nav) {
        const all = shown();
        const dir = nav.dataset.alertNav === 'prev' ? 'prev' : 'next';
        const at = all.findIndex((a) => a.id === shownId);
        shownId = all[(at + (dir === 'prev' ? -1 : 1) + all.length) % all.length]?.id ?? null;
        draw();
        container.querySelector?.(`[data-alert-nav="${dir}"]`)?.focus?.({ preventScroll: true });
        return;
      }
      const close = e.target.closest?.('[data-alert-dismiss]');
      if (close) {
        const id = close.dataset.alertDismiss;
        dismissed.add(id);
        list.find((a) => String(a.id) === id)?.onDismiss?.();
        draw();
        return;
      }
      const button = e.target.closest?.('[data-alert-action]');
      if (button) list.find((a) => String(a.id) === button.dataset.alert)?.actions?.[Number(button.dataset.alertAction)]?.onClick?.(e);
    };
    return {
      set(alerts) {
        list = Array.isArray(alerts) ? alerts : [];
        // a dismissed alert whose condition cleared shows again the next time it happens
        for (const id of dismissed) if (!list.some((a) => String(a.id) === id)) dismissed.delete(id);
        draw();
      },
    };
  }

  const Alerts = { alertsHtml, mount, sortAlerts };
  if (typeof module === 'object' && module.exports) { module.exports = Alerts; return; }
  root.Alerts = Alerts;
})(typeof window !== 'undefined' ? window : globalThis);
