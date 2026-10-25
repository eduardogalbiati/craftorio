// Safe writes of the workspace state files the app rewrites (#112: roadmap.json, queue.json):
// the content is checked by the caller's `validate` first (a write that would produce an invalid
// file is refused, logged and throws), the previous version is kept as <file>.bak, and the new one
// is written to a temp file then renamed over the old one, so a crash never leaves half a file.

const fs = require('fs');
const path = require('path');

/**
 * @param {string} file
 * @param {any} data
 * @param {{ validate?: (data) => string | null }} [opts] validate: the problem, or null when valid
 */
function writeJsonSafe(file, data, { validate } = {}) {
  const problem = validate ? validate(data) : null;
  if (problem) {
    const msg = `Refused to write ${path.basename(file)}: ${problem}`;
    console.error(`[state-file] ${msg}`);
    throw new Error(msg);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { fs.copyFileSync(file, `${file}.bak`); } catch { /* first write */ }
  renameWithRetry(tmp, file);
  return data;
}

/**
 * Writes a text or binary file whole or not at all (temp file + rename), without a .bak: the
 * discovery store's card files (#256, packages/engine/domains/discovery/discovery.js).
 * @param {string} file
 * @param {string | Buffer} content
 */
function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content);
  } catch (e) {
    fs.rmSync(tmp, { force: true }); // a write cut short (disk full) leaves no temp file
    throw e;
  }
  renameWithRetry(tmp, file);
}

// Windows: a reader holding the file open makes the rename fail with EPERM/EBUSY/EACCES for a
// moment. Retry the rename only (never copy over the file: a crash mid-copy would leave half a
// file); when it keeps failing, drop the temp file and throw, the old file stays whole.
function renameWithRetry(tmp, file, attempts = 10) {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const busy = ['EPERM', 'EBUSY', 'EACCES'].includes(e.code);
      if (!busy || i >= attempts) {
        try { fs.unlinkSync(tmp); } catch { /* gone */ }
        console.error(`[state-file] Could not replace ${path.basename(file)}: ${e.message}`);
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * i);
    }
  }
}

module.exports = {
  renameWithRetry,
  writeFileAtomic,
  writeJsonSafe,
};
