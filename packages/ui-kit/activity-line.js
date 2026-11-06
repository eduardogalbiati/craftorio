// #781: the activity line, the app's one way of saying what is happening now: one line of text naming the
// current action; while it runs a shine crosses the text and the ellipsis animates (activity-line.css, CSS only),
// when done it is a ✓ with a short summary, when it failed the reason with the step's Retry.
// html({ state, text, summary, meta, reason, retry, testid }) → the markup; state: pending | running | done |
// failed | skipped. `meta`: what goes with the action (the elapsed time, "40 of 120"); retry: { label, attrs }, attrs
// being raw markup (the caller's data-act and test id); every text is escaped here, callers pass it unescaped.
// paint(el, opts): draws the line in `el`, touching only its meta when the action did not change (a second's tick
// never restarts the shine).
// The root: .activity-line data-state, data-testid when given, role="status" running, role="alert" failed.
// Used by the wizard's analysis and Backlog card (project-wizard-activity.js) and the Product Owner's working line.
// Browser: window.ActivityLine; Node: module.exports. Needs no app.js global.
(function (root) {
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ROLES = { failed: 'alert', running: 'status' };
  const span = (cls, text) => `<span class="${cls}">${escape(text)}</span>`;

  function body({ state, text, summary, meta, reason, retry }) {
    if (state === 'running') {
      return `${span('activity-line-text', text)}<span class="activity-line-dots" aria-hidden="true"></span>${meta ? span('activity-line-meta', meta) : ''}`;
    }
    if (state === 'done') return `<span class="activity-line-check" aria-hidden="true">✓</span>${span('activity-line-text', summary || text)}`;
    if (state === 'failed') {
      const button = retry ? `<button type="button" class="btn sm activity-line-retry" ${retry.attrs || ''}>${escape(retry.label)}</button>` : '';
      return `${span('activity-line-text', reason || text)}${button}`;
    }
    return `${span('activity-line-text', text)}${summary ? span('activity-line-summary', summary) : ''}`;
  }

  /** The line's markup, see the header. */
  function html(opts = {}) {
    const state = opts.state || 'pending';
    const role = ROLES[state] ? ` role="${ROLES[state]}"` : '';
    const testid = opts.testid ? ` data-testid="${escape(opts.testid)}"` : '';
    return `<div class="activity-line" data-state="${escape(state)}"${role}${testid}>${body({ ...opts, state })}</div>`;
  }

  /** Draws the line in `el`; the same state and text only move its meta, so the shine goes on. */
  function paint(el, opts = {}) {
    const line = el?.querySelector?.('.activity-line');
    const meta = line?.querySelector?.('.activity-line-meta');
    const same = line?.getAttribute?.('data-state') === opts.state && line?.querySelector?.('.activity-line-text')?.textContent === opts.text;
    if (meta && opts.meta && same) meta.textContent = opts.meta;
    else if (el) el.innerHTML = html(opts);
  }

  const api = { html, paint };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.ActivityLine = api;
}(typeof window !== 'undefined' ? window : globalThis));
