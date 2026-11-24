// @ts-check
// The version a project's folder declares in its version file (package.json, else pyproject.toml):
// projectVersion(dir) → { file, version } or null. Read by the release prompts (#290, the
// `project_version` filter of packages/engine/engine/run/templates.js) and by a product's release
// (#46, packages/engine/domains/releases/releases.js).

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @param {string} dir
 * @returns {{ file: string, version: string } | null}
 */
function projectVersion(dir) {
  if (!dir) return null;
  const read = (name) => { try { return fs.readFileSync(path.join(String(dir), name), 'utf8'); } catch { return ''; } };
  let version = '';
  try { version = JSON.parse(read('package.json') || '{}').version || ''; } catch { /* not JSON */ }
  if (version) return { file: 'package.json', version: String(version) };
  const py = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(read('pyproject.toml'));
  return py ? { file: 'pyproject.toml', version: py[1] } : null;
}

module.exports = { projectVersion };
