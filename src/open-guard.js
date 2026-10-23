// What the desktop app may hand to the OS's default program (shell.openPath, #477 SEC-12): never a
// program an agent wrote. main.js's `artifacts:open` and `path:open` call checkOpenable first and
// answer its reason. Refused: an executable extension (case-insensitive) and, on POSIX, a file with
// an executable bit; a folder (path:open) passes the mode check, an .app bundle stays refused.
//   checkOpenable(filePath, { platform, stat }) → { ok: true } | { ok: false, reason }

const fs = require('fs');
const path = require('path');

const EXECUTABLE_EXTENSIONS = new Set([
  '.app',
  '.bat',
  '.cmd',
  '.command',
  '.desktop',
  '.exe',
  '.jar',
  '.js',
  '.lnk',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.url',
  '.vbs',
]);

function checkOpenable(filePath, { platform = process.platform, stat = fs.statSync } = {}) {
  const name = path.basename(String(filePath || ''));
  const ext = path.extname(name).toLowerCase();
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return { ok: false, reason: `Not opened: ${name} is a program (${ext}); it could run. Use Show in folder to look at it.` };
  }
  if (platform === 'win32') return { ok: true };
  let st;
  try {
    st = stat(filePath);
  } catch (e) {
    return { ok: false, reason: `Not opened: cannot read ${name} (${e.code || e.message}).` };
  }
  if (typeof st.isDirectory === 'function' && st.isDirectory()) return { ok: true };
  if (st.mode & 0o111) {
    return { ok: false, reason: `Not opened: ${name} is marked executable; it could run. Use Show in folder to look at it.` };
  }
  return { ok: true };
}

module.exports = {
  checkOpenable,
};
