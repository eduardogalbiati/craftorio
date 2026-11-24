// @ts-check
// The repository's own instructions for an isolated agent whose CLI loads none (#45): Claude Code drops
// CLAUDE.md together with the checkout's settings (`--setting-sources ''`, #468), so the engine composes
// them and the adapter passes the file (packages/engine/engine/run/sessions.js sessionInstructions,
// docs/agents/capabilities.md). `instructionsRoot`: the repository folder an agent works in;
// `composeInstructions`: its CLAUDE.md with the imports inside the repository, or its AGENTS.md.
// Every file is checked by its real path: nothing outside the repository is read.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  canonicalPath,
  isUnder,
} = require('./worktree');

const ROOT_FILES = ['CLAUDE.md', 'AGENTS.md'];
// Claude Code's own limit on imports that import
const MAX_HOPS = 5;

/**
 * The first of `roots` that holds `dir`; null in the run folder (or with no root): an agent there works on
 * no repository, and the folders above it (the workspace's own AGENTS.md, #43) are never searched.
 * @param {string} dir
 * @param {{ runDir: string, roots: unknown[] }} where
 * @returns {string | null}
 */
function instructionsRoot(dir, { runDir, roots }) {
  if (isUnder(runDir, dir)) return null;
  for (const root of roots) if (typeof root === 'string' && root && isUnder(root, dir)) return canonicalPath(root);
  return null;
}

const MAX_IMPORT = 1024;

// The text without its code: fenced blocks, and what is between two runs of backticks in one line. No
// backtracking expression over the text: the repository controls it, and must not slow the app down.
function withoutCode(text) {
  let fence = null;
  const out = [];
  for (const line of text.split('\n')) {
    const mark = /^ {0,3}(```|~~~)/.exec(line)?.[1];
    if (fence) { if (mark === fence) fence = null; continue; }
    if (mark) { fence = mark; continue; }
    const parts = line.split(/`+/);
    // an odd run opens no code: its text stays
    out.push(parts.filter((_, i) => i % 2 === 0 || i === parts.length - 1).join('`'));
  }
  return out.join('\n');
}

// The `@path` imports of an instructions file, outside code and HTML comments
function importsOf(text) {
  const prose = withoutCode(text).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  return [...prose.matchAll(/(?:^|\s)@((?:[^\s\\]|\\.)+)/g)].map((m) => m[1].replace(/\\ /g, ' ')).filter((p) => p.length <= MAX_IMPORT);
}

/**
 * @param {string} root the repository's folder
 * @returns {{ files: string[], text: string, refused: string[] }} files: what was read, by its path in the
 *   repository; refused: the imports (and root files) that leave it, as `<file>: @<import>`
 */
function composeInstructions(root) {
  const top = canonicalPath(root);
  const files = [];
  const parts = [];
  const refused = [];
  const seen = new Set();

  // the file's real path when it is a file of the repository; 'outside' when it leaves it; else null
  const inRepository = (file) => {
    const real = canonicalPath(file);
    if (!isUnder(top, real) || path.relative(top, real).split(path.sep)[0] === '.git') return 'outside';
    try { return fs.statSync(real).isFile() ? real : null; } catch { return null; }
  };

  const load = (real, hops) => {
    if (seen.has(real)) return;
    seen.add(real);
    let text;
    try { text = fs.readFileSync(real, 'utf8').replace(/^﻿/, ''); } catch { return; }
    if (text.includes('\0')) return; // not a text file
    const rel = path.relative(top, real).replace(/\\/g, '/');
    files.push(rel);
    parts.push(`Contents of ${rel}:\n\n${text.trim()}`);
    if (hops >= MAX_HOPS) return;
    for (const target of importsOf(text)) {
      // "@docs/rules.md." at the end of a sentence
      const names = [...new Set([target, target.replace(/[.,;:!?)]+$/, '')])].filter(Boolean);
      for (const name of names) {
        const file = /^~(?:[\\/]|$)/.test(name) ? path.join(os.homedir(), name.slice(1)) : path.resolve(path.dirname(real), name);
        const found = inRepository(file);
        if (!found) continue;
        if (found === 'outside') refused.push(`${rel}: @${name}`);
        else load(found, hops + 1);
        break;
      }
    }
  };

  for (const name of ROOT_FILES) {
    const found = inRepository(path.join(top, name));
    if (found === 'outside') refused.push(name);
    else if (found) load(found, 0);
    if (files.length) break;
  }
  const text = files.length ? `The instructions of the repository you work in (its ${files.join(', ')}):\n\n${parts.join('\n\n---\n\n')}\n` : '';
  return { files, text, refused };
}

module.exports = {
  composeInstructions,
  instructionsRoot,
};
