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
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows: a reader holding the file open (EPERM/EBUSY); the copy keeps the old one on failure
    let copied = true;
    try { fs.copyFileSync(tmp, file); } catch { copied = false; }
    try { fs.unlinkSync(tmp); } catch { /* gone */ }
    if (!copied) throw e;
  }
  return data;
}

module.exports = {
  writeJsonSafe,
};
