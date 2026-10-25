'use strict';
// Watches one agent turn's stream (the items of providers.js) for silence while a tool call is
// open: an agent waiting on a command that never ends (a background job polled for a text that
// never shows up, a hung process). Also splits the turn's time into active (the model thinking,
// writing, calling tools) and waiting (at least one tool call running), and counts the silent part
// of the waits longer than the threshold as stalled.
//
// Pure: time comes from `now()`; the engine calls check() on a timer.

class IdleWatch {
  /** @param {{ idleMs?: number, now?: () => number }} [options] */
  constructor({ idleMs, now = Date.now } = {}) {
    this.idleMs = idleMs;
    this.now = now;
    this.started = this.last = now();
    this.open = new Map();          // tool call id → call
    this.lastCall = null;
    this.waitSince = null;          // since when a tool call has been open
    this.waitingMs = 0;
    this.stalledMs = 0;
    this.warned = false;            // one warning per silence
    this.lastStall = null;          // the last check() that warned
  }

  // Every stream item is activity; tool_call / tool_result open and close waits.
  item(item) {
    const t = this.now();
    this.closeSilence(t);
    this.last = t;
    this.warned = false;
    if (item.kind === 'tool_call') {
      if (!this.open.size) this.waitSince = t;
      this.open.set(item.id, item);
      this.lastCall = item;
    } else if (item.kind === 'tool_result' && this.open.delete(item.id) && !this.open.size) {
      this.waitingMs += t - this.waitSince;
      this.waitSince = null;
    }
  }

  // The silence that just ended counts as stalled past the threshold, if a command was waiting.
  closeSilence(t) {
    if (this.open.size && this.idleMs > 0 && t - this.last >= this.idleMs) this.stalledMs += t - this.last - this.idleMs;
  }

  // → { idle_ms, command, tool } the first time a silence with an open tool call reaches the
  // threshold, else null.
  check() {
    if (this.warned || !this.open.size || !(this.idleMs > 0)) return null;
    const idle = this.now() - this.last;
    if (idle < this.idleMs) return null;
    this.warned = true;
    const call = [...this.open.values()].pop();
    return (this.lastStall = { idle_ms: idle, tool: call.name || 'tool', command: describeCall(call) });
  }

  // Whether `stall` (a check() result) is still going on: no stream item since it warned and the
  // turn has not finished. A decision taken on it later (the supervisor's interrupt) may be stale.
  stillStalled(stall) {
    return !!stall && this.warned && this.lastStall === stall && this.open.size > 0;
  }

  // Totals of the turn; call once when it ends.
  finish() {
    const t = this.now();
    this.closeSilence(t);
    if (this.waitSince != null) this.waitingMs += t - this.waitSince;
    this.waitSince = null;
    this.open.clear();
    const duration = t - this.started;
    return { duration_ms: duration, active_ms: Math.max(0, duration - this.waitingMs), waiting_ms: this.waitingMs, stalled_ms: this.stalledMs };
  }
}

function describeCall(call) {
  const input = call?.input;
  return String(input?.command ?? input?.cmd ?? JSON.stringify(input ?? '')).slice(0, 300);
}

module.exports = { IdleWatch, describeCall };
