// One merge at a time across the runs of this process (the service runs several at once, #49).
//
// A transition that merges (`precheck:` before its action, or `merge: local`) runs its check and its
// merge inside `serialize(key, fn)`: the next run's check only starts once the previous merge ended,
// so it sees the base that merge produced. `key` is the repository (another repository's merges do
// not wait). After a merge, `merged` is emitted: runs waiting at a gate with `check:` re-check their
// PR/MR then, and one that now conflicts takes its recovery path before anyone approves it.

const { EventEmitter } = require('events');

const tails = new Map(); // key -> promise of the last merge queued for it
const events = new EventEmitter();
events.setMaxListeners(0); // one listener per open gate with a check

function serialize(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.catch(() => {}); // a failed merge does not block the next one
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

// { key, runId }: a run merged into `key`'s base
function notifyMerged(info) {
  events.emit('merged', info);
}

function onMerged(listener) {
  events.on('merged', listener);
  return () => events.off('merged', listener);
}

module.exports = { serialize, notifyMerged, onMerged };
