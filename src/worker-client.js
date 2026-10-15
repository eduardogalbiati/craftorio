// One worker thread per module file that answers requests off the main process (#389): the local
// usage scan (src/local-usage-worker.js) and the CLI probes (src/tool-worker.js). The worker is
// started on the first request and kept for the next ones; it never keeps the process alive while
// no request waits. Protocol: the request goes as { id, ...message }, the worker answers
// { id, result } or { id, error }. The worker is started from source text (eval), so that it also
// loads from the packaged app.asar.

const { Worker } = require('worker_threads');

/** call(message) → Promise of the worker's result for it. */
function workerClient(file) {
  let worker = null;
  let nextId = 0;
  const pending = new Map(); // id → { resolve, reject }

  function failAll(err) {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }

  function start() {
    if (worker) return worker;
    const w = new Worker(`require(${JSON.stringify(file)});`, { eval: true });
    w.on('message', ({ id, result, error }) => {
      const p = pending.get(id);
      pending.delete(id);
      if (!pending.size) w.unref();
      if (!p) return;
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    });
    w.on('error', (e) => { if (worker === w) worker = null; failAll(e); });
    w.on('exit', () => { if (worker === w) worker = null; failAll(new Error('The worker thread stopped.')); });
    w.unref();
    worker = w;
    return w;
  }

  return function call(message) {
    const w = start();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.ref();
      try { w.postMessage({ ...message, id }); } catch (e) {
        // a message that cannot be copied (DataCloneError): nothing waits for an answer
        pending.delete(id);
        if (!pending.size) w.unref();
        reject(e);
      }
    });
  };
}

module.exports = {
  workerClient,
};
