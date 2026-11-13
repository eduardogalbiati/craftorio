// A deterministic step's log path as the run shows it: relative to the run folder (`logs/…`), from the
// last `/logs/` of an absolute or Windows path; null when it is not under the run's logs/ folder.
// Shared by the Run screen's terminal buttons (fronts/build/views/run/run.js stepLogs, #465) and the run
// chat's orchestrator messages (fronts/build/views/runchat/run-chat-model.js, #795).
// Browser: window.runLogPath; Node: module.exports.
(function (root) {
  function runLogPath(p) {
    const s = String(p || '').replace(/\\/g, '/');
    const at = s.lastIndexOf('/logs/');
    return at >= 0 ? s.slice(at + 1) : s.startsWith('logs/') ? s : null;
  }
  if (typeof module === 'object' && module.exports) module.exports = { runLogPath };
  else root.runLogPath = runLogPath;
})(typeof window !== 'undefined' ? window : globalThis);
