// A status as people read it (#266): every run and item status id ("running", "failed", "local"…)
// has one label ("Running", "Failed", "Merged locally") and one pill colour, for every screen.
// - statusLabel(status, { waiting }): the label; a run waiting at a human gate reads "Waiting for
//   you" whatever its status; an unknown id falls back to itself with its first letter capitalised.
// - statusPill(status, { waiting, title, className }): the pill's markup. The id stays in
//   `data-status` (tests and E2E steps read it, never the label); the label is the element with
//   data-testid="status-label". A running pill's label leads with the sidebar's blue dot
//   (`.status-dot`, pulsing: style.css).
// Browser: window.StatusPill; Node: module.exports.
// load: early (app.js draws the header's and the sidebar's statuses with it)
(function (root) {
  // id → [pill colour (style.css .pill-<colour>), label]
  const STATUS = {
    cancelled: ['cancelled', 'Cancelled'],
    delivered: ['success', 'Delivered'],
    done: ['success', 'Done'],
    failed: ['failed', 'Failed'],
    failed_to_start: ['failed', 'Failed to start'],
    idle: ['idle', 'Idle'],
    in_delivery: ['running', 'In delivery'],
    in_progress: ['running', 'In progress'],
    interrupted: ['interrupted', 'Interrupted'],
    local: ['success', 'Merged locally'],
    paused: ['cancelled', 'Paused'],
    pending: ['idle', 'Pending'],
    planned: ['idle', 'Planned'],
    queued: ['idle', 'Queued'],
    released: ['success', 'Released'],
    running: ['running', 'Running'],
    simulated: ['idle', 'Simulated'],
    skipped: ['interrupted', 'Skipped'],
    stopped: ['cancelled', 'Stopped'],
    succeeded: ['success', 'Succeeded'],
    success: ['success', 'Succeeded'],
    todo: ['idle', 'To do'],
    waiting: ['cancelled', 'Waiting for you'],
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // the id the pill shows: "waiting" for a run at a human gate
  const idOf = (status, waiting) => (waiting ? 'waiting' : String(status || '').trim());

  function statusLabel(status, { waiting = false } = {}) {
    const id = idOf(status, waiting);
    if (STATUS[id]) return STATUS[id][1];
    const words = id.replace(/[_-]+/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function statusPill(status, { waiting = false, title = '', className = '' } = {}) {
    const id = idOf(status, waiting);
    const colour = STATUS[id]?.[0] || 'idle';
    const label = esc(statusLabel(id));
    const attrs = `data-status="${esc(id)}"`;
    const cls = `pill pill-${colour}${className ? ` ${esc(className)}` : ''}`;
    const tip = title ? ` title="${esc(title)}"` : '';
    // running: the label carries the pulsing dot (its ::before)
    if (id === 'running') return `<span class="${cls}" ${attrs}${tip}><span class="status-dot" ${attrs} data-testid="status-label">${label}</span></span>`;
    return `<span class="${cls}" ${attrs}${tip} data-testid="status-label">${label}</span>`;
  }

  const api = {
    statusLabel,
    statusPill,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatusPill = api;
})(typeof window !== 'undefined' ? window : globalThis);
