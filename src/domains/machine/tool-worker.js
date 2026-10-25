// The worker thread of src/service/common.js runTool (#389): starts a CLI probe (`claude --version`,
// `gh auth status`...) off the main process. On Windows, starting a large executable the first time
// blocks the starting thread for up to seconds (the antivirus scans it): here it blocks this thread.
//
// Message in: { id, file, args, opts }; out: { id, result: { ok, out } }.

const { parentPort } = require('worker_threads');
const { execShim } = require('./shell');

parentPort.on('message', ({ id, file, args, opts }) => {
  try {
    execShim(file, args, opts, (err, stdout, stderr) => {
      parentPort.postMessage({ id, result: { ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() } });
    });
  } catch (e) {
    parentPort.postMessage({ id, result: { ok: false, out: e.message || String(e) } });
  }
});
