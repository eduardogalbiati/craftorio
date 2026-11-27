// The replay of the run's 3D view (run3d.js, the overlay; run3d/ draws it), pure like the model it
// plays (run3d-model.js): no DOM, no three.js, no clock of its own (test/run3d-replay.test.js).
// A Run3DPlayer keeps every event of the run and two models:
// - `head`: the fold of all the events, the run as it is now. While the player is at the head the
//   views read it: a live run is shown live, a finished run on its final state, as before the replay.
// - `past`: the fold of the events up to the replayed moment `t`. Seeking is "the state kept at the
//   last step boundary before `t`, then the events up to `t`" (a snapshot at each step.started and at
//   least every SNAPSHOT_EVERY events), playing folds only the events the clock passed: never the
//   whole run again. It stands on the head's floor, so the floor does not change while replaying.
// Leaving the head (pause, seek, step) never stops the run's events: they keep going into `head`
// and are shown again by toHead() (the "Live" button), or when a playing replay catches up.
// Replay time: milliseconds from the run's start, with the long waits for the owner cut short (a
// gate answered after an hour keeps WAIT_KEPT_MS of it): `replayOf` / `realOf` convert, `strip`
// says where the cuts are. Only a replay is shortened: at the head of a live run the strip is in
// real time.
// Browser: window.Run3DReplay; Node: module.exports.
(function (root) {
  const lib = () => (typeof module === 'object' && module.exports ? require('./run3d-model') : root.Run3DModel);
  const SPEEDS = [1, 4, 16, 64]; // seconds of the run per second: at 64× an hour takes under a minute
  const DEFAULT_SPEED = 16;
  const WAIT_CUT_OVER_MS = 60000; // a wait for the owner longer than this is cut in a replay...
  const WAIT_KEPT_MS = 45000; // ...to this much
  const SNAPSHOT_EVERY = 2000; // events between two kept states at most (a step with thousands of stream items)
  const NOTIFY_MS = 100; // a playing replay tells the views this often
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  class Run3DPlayer {
    /** `mainGates`, `prices`: as Run3DModel (the human gates drawn before the run reaches them, the user's prices). */
    constructor({ mainGates = [], prices } = {}) {
      const { Run3DModel } = lib();
      this.head = new Run3DModel({ mainGates, prices });
      this.past = new Run3DModel({ prices });
      this.past.floorOf = this.head;
      this.blank = this.past.dump();
      this.events = []; // every event applied to the head, in order
      this.ts = []; // their time (ms), never going back
      this.snaps = []; // { n, dump }: the head's state after its first n events
      this.asks = {}; // approval id → when it was asked (not answered yet)
      this.cuts = []; // answered waits cut short: { from, to } in real time
      this.atHead = true;
      this.playing = false;
      this.speed = DEFAULT_SPEED;
      this.t = 0; // the replayed moment, in replay time
      this.n = 0; // the events folded into `past`
      this.floorAt = 0; // the events up to the first workflow.started: the least a replayed moment has (its floor)
      this.epoch = 0; // grows when the shown moment jumps (a seek, back to the head): the cart is put, not driven
      this.version = 0;
      this.sinceNotify = 0;
      this.listeners = new Set();
      this._cuts = null;
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    /** Tells the views something changed (also the overlay's clock tick). */
    notify() {
      this.version++;
      this.sinceNotify = 0;
      for (const fn of [...this.listeners]) fn();
    }

    // ---- the run's events in ----
    /** Takes one event of the run (kept even while replaying); true when it changed the head. */
    push(ev) {
      if (!ev || typeof ev !== 'object') return false;
      if (ev.seq && ev.seq <= this.head.seq) return false; // recorded + live overlap
      const parsed = Date.parse(ev.ts), last = this.ts.length ? this.ts[this.ts.length - 1] : 0;
      const ts = Number.isFinite(parsed) ? Math.max(parsed, last) : last;
      const n = this.events.length, kept = this.snaps.length ? this.snaps[this.snaps.length - 1].n : 0;
      if (n > kept && (ev.type === 'step.started' || n - kept >= SNAPSHOT_EVERY)) this.snaps.push({ n, dump: this.head.dump() });
      this.events.push(ev);
      this.ts.push(ts);
      if (ev.type === 'workflow.started' && !this.floorAt) this.floorAt = this.events.length;
      if (ev.type === 'approval.requested') this.asks[ev.approval_id] = ts;
      else if (ev.type === 'approval.resolved') this.answered(ev.approval_id, ts);
      else if (ev.type === 'workflow.finished' || ev.type === 'workflow.started') for (const id of Object.keys(this.asks)) this.answered(id, ts);
      this._cuts = null;
      return this.head.apply(ev);
    }

    answered(id, ts) {
      const asked = this.asks[id];
      delete this.asks[id];
      if (asked != null && ts - asked > WAIT_CUT_OVER_MS) this.cuts.push({ from: asked + WAIT_KEPT_MS, to: ts });
    }

    /** Takes events in order and tells the views once (while replaying: on the next clock tick). */
    add(events) {
      let changed = false;
      for (const ev of events || []) changed = this.push(ev) || changed;
      if (changed && this.atHead) this.notify();
      return changed;
    }

    /** A past run that never recorded its end: its head is shown as interrupted. */
    interrupt() {
      const done = this.head.interrupt();
      this._cuts = null;
      if (done) this.notify();
      return done;
    }

    setMainGates(mainGates) { this.head.mainGates = new Set(mainGates); }

    // ---- what the views read ----
    /** The model to draw: the head, or the replayed moment. */
    get model() { return this.atHead ? this.head : this.past; }
    /** Showing a running run as it happens. */
    get live() { return this.atHead && this.head.live; }
    /** Time moves on screen: a live head, or a replay that plays. */
    get moving() { return this.atHead ? this.head.live : this.playing; }

    get origin() { return this.head.run.startedAt ?? this.ts[0] ?? 0; }
    get endTs() {
      const last = this.ts.length ? this.ts[this.ts.length - 1] : 0;
      return Math.max(this.origin, this.head.finished ? this.head.run.endedAt ?? last : last);
    }

    /** The waits cut short in a replay, merged and in order: [{ from, to }] in real time. */
    waitCuts() {
      if (this._cuts) return this._cuts;
      const end = this.endTs, all = [...this.cuts];
      // a wait still open (the run waits now, or ended without an answer) is cut up to what is known
      for (const asked of Object.values(this.asks)) if (end - asked > WAIT_CUT_OVER_MS) all.push({ from: asked + WAIT_KEPT_MS, to: end });
      all.sort((a, b) => a.from - b.from);
      const merged = [];
      for (const c of all) {
        const prev = merged[merged.length - 1];
        if (c.to <= c.from || c.from < this.origin) continue;
        if (prev && c.from <= prev.to) prev.to = Math.max(prev.to, c.to);
        else merged.push({ from: c.from, to: c.to });
      }
      return (this._cuts = merged);
    }

    /** A real time (ms) → replay time (ms from the run's start, the cut waits taken out). */
    replayOf(ts) {
      let cut = 0;
      for (const c of this.waitCuts()) {
        if (ts <= c.from) break;
        cut += Math.min(ts, c.to) - c.from;
      }
      return Math.max(0, ts - this.origin - cut);
    }

    /** A replay time → the last real time it stands for (the end of a cut wait, at the cut). */
    realOf(t) {
      let ts = this.origin + Math.max(0, t);
      for (const c of this.waitCuts()) {
        if (ts < c.from) break;
        ts += c.to - c.from;
      }
      return Math.min(ts, this.endTs);
    }

    /** The length of the replay (ms): the run so far, the cut waits taken out. */
    get duration() { return this.replayOf(this.endTs); }

    /** Now, as the views see it: the wall clock at the head, the replayed moment's real time in a replay. */
    now(wall = this.endTs) { return this.atHead ? wall : this.realOf(this.t); }

    /** The robot state at the shown moment (a replay keeps `done` visible at its speed). */
    robotState(key, wall) { return this.model.robotState(key, this.now(wall), this.atHead ? 1 : this.speed); }

    /** How far a step's running visit is (0..1): a replay knows when it ends; null at the head. */
    progress(id) {
      if (this.atHead) return null;
      const st = this.past.state[id];
      if (!st || !st.visits || st.t1 != null) return null;
      const v = this.head.visits.find((x) => x.step === id && x.t0 === st.t0);
      if (!v || v.t1 == null) return null;
      const from = this.replayOf(v.t0), to = this.replayOf(v.t1);
      return to > from ? clamp01((this.t - from) / (to - from)) : null;
    }

    /** How far the replayed moment is behind the head: { events, ms } (`wall`: now, for a live run). */
    behind(wall = 0) {
      if (this.atHead) return { events: 0, ms: 0 };
      const end = this.head.live ? Math.max(wall, this.endTs) : this.endTs;
      return { events: this.events.length - this.n, ms: Math.max(0, end - this.realOf(this.t)) };
    }

    /** The clock of the timeline, in the run's real time: { at, total, cut } (ms; cut: what a replay skips). */
    clock(wall = this.endTs) {
      const total = this.live ? this.head.elapsed(wall) : this.endTs - this.origin;
      return { at: this.atHead ? total : this.realOf(this.t) - this.origin, total, cut: this.waitCuts().reduce((sum, c) => sum + c.to - c.from, 0) };
    }

    /**
     * The timeline strip: { live, span (ms), at (the playhead, 0..1, null on a live head), visits
     * [{ step, visit, left, width (0..1), ms (real), open, todo }], cuts [{ at (0..1), ms }] }. A live
     * head is in real time and grows with the clock; anything else is in replay time (waits cut).
     */
    strip(wall = this.endTs) {
      const head = this.head, origin = this.origin;
      if (this.live) {
        const span = Math.max(1, head.elapsed(wall)), end = origin + span;
        return {
          live: true, span, at: null, cuts: [],
          visits: head.visits.map((v) => ({ step: v.step, visit: v.visit, left: clamp01((v.t0 - origin) / span), width: clamp01(((v.t1 ?? end) - v.t0) / span), ms: (v.t1 ?? end) - v.t0, open: v.t1 == null, todo: false })),
        };
      }
      const span = Math.max(1, this.duration), end = this.endTs, t = this.atHead ? span : this.t;
      return {
        live: false, span, at: clamp01(t / span),
        cuts: this.waitCuts().map((c) => ({ at: clamp01(this.replayOf(c.from) / span), ms: c.to - c.from })),
        visits: head.visits.map((v) => {
          const from = this.replayOf(v.t0), to = this.replayOf(v.t1 ?? end);
          return { step: v.step, visit: v.visit, left: clamp01(from / span), width: clamp01((to - from) / span), ms: (v.t1 ?? end) - v.t0, open: false, todo: from > t };
        }),
      };
    }

    // ---- the controls ----
    /** The number of events at or before a real time. */
    indexAt(ts) {
      let lo = 0, hi = this.ts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.ts[mid] <= ts) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    // `past` becomes the fold of the first `count` events: forward from where it is when it can, else
    // from the last kept state at or before `count`
    foldTo(count) {
      let lo = 0, hi = this.snaps.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.snaps[mid].n <= count) lo = mid + 1; else hi = mid;
      }
      const snap = lo ? this.snaps[lo - 1] : null;
      if (count < this.n || (snap && snap.n > this.n)) {
        this.past.restore(snap ? snap.dump : this.blank);
        this.n = snap ? snap.n : 0;
      }
      while (this.n < count) this.past.apply(this.events[this.n++]);
    }

    show(t) {
      this.atHead = false;
      this.t = Math.max(0, t);
      // never before the run's start: events recorded out of order must not leave the moment without its floor
      this.foldTo(Math.max(this.floorAt, this.indexAt(this.realOf(this.t))));
    }

    /** Shows the moment `t` (replay time); at or past the end: back to the head. */
    seek(t) {
      if (!(t < this.duration)) return this.toHead();
      this.show(t);
      this.epoch++;
      this.notify();
      return true;
    }

    /** A point of the strip (0..1) as it is drawn: in real time on a live head, else in replay time. */
    seekStrip(fraction, wall = this.endTs) {
      const f = clamp01(fraction);
      return this.seek(this.live ? this.replayOf(this.origin + f * this.head.elapsed(wall)) : f * this.duration);
    }

    /** Back to the head: the run as it is now (live again when it runs). */
    toHead() {
      if (this.atHead) return false;
      this.atHead = true;
      this.playing = false;
      this.epoch++;
      this.notify();
      return true;
    }

    /** Play: a finished run from its start when it is at its end; a paused replay goes on. */
    play() {
      if (this.atHead) {
        if (this.head.live || !(this.duration > 0)) return false; // live already, or nothing to replay
        this.show(0);
        this.epoch++;
      }
      this.playing = true;
      this.notify();
      return true;
    }

    /** Pause: a live head freezes on this moment (the run goes on, its events are kept); a replay stops. */
    pause() {
      if (this.atHead) {
        if (!this.head.live) return false;
        this.show(this.duration);
      }
      this.playing = false;
      this.notify();
      return true;
    }

    toggle() { return this.moving ? this.pause() : this.play(); }

    setSpeed(speed) {
      if (!SPEEDS.includes(speed) || speed === this.speed) return false;
      this.speed = speed;
      this.notify();
      return true;
    }

    /** The clock moved `ms` (real): a playing replay advances `ms × speed`; at the end, the head. */
    tick(ms) {
      if (this.atHead || !this.playing || !(ms > 0)) return false;
      const t = this.t + ms * this.speed;
      if (!(t < this.duration)) return this.toHead();
      this.show(t);
      this.sinceNotify += ms;
      if (this.sinceNotify >= NOTIFY_MS) this.notify();
      return true;
    }

    /** The starts of the step visits, in replay time: where Left / Right step to. */
    marks() {
      const d = this.duration;
      return [...new Set([0, ...this.head.visits.map((v) => this.replayOf(v.t0))])].filter((t) => t < d).sort((a, b) => a - b);
    }

    /** Steps to the start of the previous (-1) or the next (+1) step visit; past the last: the head. */
    step(dir) {
      const d = this.duration, t = this.atHead ? d : this.t, marks = this.marks();
      if (dir < 0) {
        // while it plays, "back" within a second of a start goes to the one before (as a media player does)
        const slack = !this.atHead && this.playing ? this.speed * 1000 : 0;
        const before = marks.filter((m) => m < t - slack);
        return this.seek(before.length ? before[before.length - 1] : 0);
      }
      const next = marks.find((m) => m > t);
      return next == null ? this.toHead() : this.seek(next);
    }

    /** Moves the replayed moment by a part of the timeline (0.01: one percent forward). */
    nudge(fraction) {
      const d = this.duration;
      return this.seek(Math.max(0, (this.atHead ? d : this.t) + fraction * d));
    }
  }

  /**
   * What a key does to the replay while the overlay has the focus: 'toggle' (Space), 'back' / 'forward'
   * (Left / Right: the previous / next step), 'nudge-back' / 'nudge-forward' (with Shift: 1% of the
   * timeline), or null. `field`: a text field has the focus (it keeps its keys); `pressable`: a
   * button or a tab focused with the keyboard (Space presses it; one clicked with the mouse does not
   * hold Space back); `modifier`: Ctrl, Alt or Meta is down.
   */
  function keyAction(key, { shift = false, modifier = false, field = false, pressable = false } = {}) {
    if (modifier || field) return null;
    if (key === ' ' || key === 'Spacebar') return pressable ? null : 'toggle';
    if (key === 'ArrowLeft') return shift ? 'nudge-back' : 'back';
    if (key === 'ArrowRight') return shift ? 'nudge-forward' : 'forward';
    return null;
  }

  const api = {
    DEFAULT_SPEED,
    keyAction,
    Run3DPlayer,
    SPEEDS,
    WAIT_CUT_OVER_MS,
    WAIT_KEPT_MS,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Run3DReplay = api;
})(typeof window !== 'undefined' ? window : globalThis);
