// Folder trust for the interactive CLIs. Each CLI asks once per folder whether you trust it and
// remembers the answer in its own config. Only the workspace folders the app writes itself (runs/,
// skills/, workflows/) are trusted by the Sessions screen before starting a CLI there
// (trustWorkspaceFolder, #468); repos/, worktrees/ and project folders hold repository-controlled
// code, so the CLI asks in its own terminal. Only the folder and its git repository's root are
// trusted: Claude Code does not inherit a parent's trust past a repository root.
//
//   Claude Code  ~/.claude.json                projects["C:/path"].hasTrustDialogAccepted = true
//   Codex CLI    ~/.codex/config.toml          [projects.'C:\path']  trust_level = "trusted"
//   Grok Build   ~/.grok/trusted_folders.toml  [folders.'C:\path']   trusted = true
//
// CLAUDE_CONFIG_DIR and CODEX_HOME move the first two (src/domains/cli/cli-config-dirs.js).
// A CLI that was never set up (no config yet) is left alone: it asks the first time, as usual.

const fs = require('fs');
const path = require('path');
const { cliConfigDirs } = require('./cli-config-dirs');
const { pathKey } = require('../machine/platform-paths');
const registry = require('../../shared/providers');

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

function trustClaude(file, dirs) {
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

function trustDirs(provider, dirs, home) {
  const trust = registry.byId(provider)?.trust;
  if (!trust || !dirs.length) return false;
  const cfg = cliConfigDirs(home);
  if (trust.format === 'claude-json') return trustClaude(cfg.claudeJson, dirs);
  return trustToml(path.join(cfg[provider], trust.file), dirs, trust.table, trust.entry());
}

/** Records that `dir` is trusted in the CLI's own config (its adapter's `trust`; no-op when it already is). */
function trustFolder(provider, dir, { home } = {}) {
  return trustDirs(provider, foldersToTrust(dir), home);
}

// #468 (SEC-3): the keys of the workspace layout (src/workspace.js) whose folders the app writes
// itself. repos/, worktrees/ and project folders hold repository-controlled code: the CLI keeps its
// own trust prompt there.
const APP_FOLDERS = [
  'runs',
  'skills',
  'workflows',
];

function isInside(dir, root) {
  const rel = path.relative(pathKey(root), pathKey(dir));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Trusts `dir` only when it is in one of the workspace's app folders (runs/, skills/, workflows/);
 * a git root above it is trusted only when it is in one too. False, nothing written, otherwise.
 */
function trustWorkspaceFolder(provider, dir, { workspace, home } = {}) {
  if (!workspace) return false;
  const ws = require('../../workspace').layout(workspace); // lazy: workspace.js loads the engine
  const roots = APP_FOLDERS.map((f) => ws[f]);
  const owned = (d) => roots.some((r) => isInside(d, r));
  if (!owned(dir)) return false;
  return trustDirs(provider, foldersToTrust(dir).filter(owned), home);
}

module.exports = {
  foldersToTrust,
  trustFolder,
  trustWorkspaceFolder,
};
