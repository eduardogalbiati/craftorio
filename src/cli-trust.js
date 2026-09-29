// Folder trust for the interactive CLIs. Each CLI asks once per folder whether you trust it and
// remembers the answer in its own config; folders inside the workspace (projects, repos, runs,
// worktrees) are the app's own, so the Sessions screen records that answer before starting a CLI
// there. Only the folder and its git repository's root are trusted: Claude Code does not inherit
// a parent's trust past a repository root.
//
//   Claude Code  ~/.claude.json                projects["C:/path"].hasTrustDialogAccepted = true
//   Codex CLI    ~/.codex/config.toml          [projects.'C:\path']  trust_level = "trusted"
//   Grok Build   ~/.grok/trusted_folders.toml  [folders.'C:\path']   trusted = true
//
// A CLI that was never set up (no config yet) is left alone: it asks the first time, as usual.

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The folder and the root of the git repository it is in (when it is in one). */
function foldersToTrust(dir) {
  const out = [path.resolve(dir)];
  for (let cur = out[0]; ;) {
    if (fs.existsSync(path.join(cur, '.git'))) { if (cur !== out[0]) out.push(cur); break; }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

// Replaces a file in one step, so a CLI reading it never sees half of it. Windows refuses the
// rename while another process holds the file open: then it is written in place.
function replaceFile(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, text); fs.rmSync(tmp, { force: true }); }
}

function trustClaude(home, dirs) {
  const file = path.join(home, '.claude.json');
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const config = JSON.parse(text);
  config.projects ??= {};
  let changed = false;
  for (const d of dirs) {
    const key = d.replace(/\\/g, '/');
    if (config.projects[key]?.hasTrustDialogAccepted) continue;
    config.projects[key] = { ...config.projects[key], hasTrustDialogAccepted: true };
    changed = true;
  }
  if (changed) replaceFile(file, JSON.stringify(config, null, 2));
  return changed;
}

// TOML tables keyed by a path in a literal string ('...': no escapes). A path with a quote can't be one.
function trustToml(file, dirs, table, body) {
  if (!fs.existsSync(path.dirname(file))) return false;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const has = (d) => text.toLowerCase().includes(`[${table}.'${d}']`.toLowerCase());
  const add = dirs.filter((d) => !d.includes("'") && !has(d));
  if (!add.length) return false;
  const sep = !text || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}${add.map((d) => `\n[${table}.'${d}']\n${body}\n`).join('')}`);
  return true;
}

/** Records that `dir` is trusted in the CLI's own config (no-op when it already is). */
function trustFolder(provider, dir, { home = os.homedir() } = {}) {
  const dirs = foldersToTrust(dir);
  if (provider === 'claude') return trustClaude(home, dirs);
  if (provider === 'codex') return trustToml(path.join(home, '.codex', 'config.toml'), dirs, 'projects', 'trust_level = "trusted"');
  if (provider === 'grok') return trustToml(path.join(home, '.grok', 'trusted_folders.toml'), dirs, 'folders', `trusted = true\ndecided_at = ${Math.floor(Date.now() / 1000)}`);
  return false;
}

module.exports = { trustFolder, foldersToTrust };
