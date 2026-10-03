// Seeding of bundled defaults into the workspace: the app folder (app.asar in the packaged app)
// is read-only and only holds the defaults; the user edits the copies in <workspace>.
// Used for the skills (<workspace>/skills, one folder per skill) and the workflows
// (<workspace>/workflows, one YAML file per workflow).
//
// <dest>/.seeded.json maps each copied entry id -> hash of what was copied. For each bundled entry:
// - never seeded and missing          -> copy it
// - never seeded, the user has one    -> keep the user's (it is theirs)
// - seeded, user deleted it           -> leave it deleted (defaults do not come back)
// - seeded, untouched, app has update -> replace it with the new version
// - seeded, edited by the user        -> keep the user's version ("a newer default exists" in status)
// - seeded, edited only where the kind allows (a workflow's input defaults, #203: `kind.baseHash`
//   ignores them, `kind.carryOver` writes the new version with the user's values) -> updated, the
//   user's values kept. The base hash of each seeded version is kept under DEFAULTS_KEY.
// Entries the user created are never touched.

const fs = require('fs');
const path = require('path');

const MANIFEST = '.seeded.json';
// manifest key of { id: base hash of the seeded version } (kinds with baseHash); never an entry id
const DEFAULTS_KEY = '#base';
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function readManifest(destDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(destDir, MANIFEST), 'utf8').replace(/^﻿/, ''));
    // legacy format: list of ids without hashes (never auto-updated)
    return Array.isArray(raw) ? Object.fromEntries(raw.map((id) => [id, null])) : raw || {};
  } catch {
    return {}; // first time
  }
}

const writeManifest = (destDir, seeded) => fs.writeFileSync(path.join(destDir, MANIFEST), JSON.stringify(seeded, null, 2));

// Copies a folder byte by byte (fs.cpSync cannot read from inside app.asar).
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

/**
 * Seeds the bundled entries of srcDir into destDir.
 * kind: { list(dir) -> ids, exists(dir, id), hash(dir, id), copy(srcDir, destDir, id), remove(dir, id) }
 * @returns the ids that were copied or updated.
 */
function seedBundle(srcDir, destDir, kind) {
  if (!isDir(srcDir)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const seeded = readManifest(destDir);
  const bases = kind.baseHash ? { ...(seeded[DEFAULTS_KEY] || {}) } : null;
  const changed = [];
  const current = (id) => { if (bases) bases[id] = kind.baseHash(srcDir, id); };
  for (const id of kind.list(srcDir)) {
    const srcHash = kind.hash(srcDir, id);
    const exists = kind.exists(destDir, id);
    const destHash = exists ? kind.hash(destDir, id) : null;
    if (destHash === srcHash) { seeded[id] = srcHash; current(id); continue; } // already the current default
    if (!(id in seeded)) {
      if (exists) continue; // the user already has one with this name
    } else if (exists && seeded[id] !== null && seeded[id] !== srcHash && destHash !== seeded[id]
      && bases?.[id] && kind.baseHash(destDir, id) === bases[id] && kind.carryOver) {
      // edited only where the kind allows (a workflow's input defaults): the new version with the user's values
      if (!kind.carryOver(srcDir, destDir, id)) continue;
      seeded[id] = srcHash;
      current(id);
      changed.push(id);
      continue;
    } else if (!exists || seeded[id] === null || seeded[id] === srcHash || destHash !== seeded[id]) {
      continue; // deleted, legacy, already current, or edited by the user
    } else {
      kind.remove(destDir, id);
    }
    kind.copy(srcDir, destDir, id);
    seeded[id] = srcHash;
    current(id);
    changed.push(id);
  }
  if (bases) seeded[DEFAULTS_KEY] = bases;
  writeManifest(destDir, seeded);
  return changed;
}

/**
 * Where each entry of destDir comes from.
 * @returns {{ [id]: { origin: 'default'|'modified'|'custom', updateAvailable: boolean, restorable: boolean } }}
 *   default: an untouched copy of a bundled entry; modified: a bundled copy the user edited;
 *   custom: created by the user. updateAvailable: the app ships a newer default than the one the
 *   user edited. restorable: the bundled default can replace the user's version.
 */
function bundleStatus(srcDir, destDir, kind) {
  const seeded = readManifest(destDir);
  const bundled = new Set(isDir(srcDir) ? kind.list(srcDir) : []);
  const out = {};
  for (const id of isDir(destDir) ? kind.list(destDir) : []) {
    if (!(id in seeded) || id === DEFAULTS_KEY) { out[id] = { origin: 'custom', updateAvailable: false, restorable: false }; continue; }
    const hash = kind.hash(destDir, id);
    const srcHash = bundled.has(id) ? kind.hash(srcDir, id) : null;
    const untouched = seeded[id] === null ? hash === srcHash : hash === seeded[id];
    out[id] = {
      origin: untouched ? 'default' : 'modified',
      updateAvailable: !untouched && !!srcHash && seeded[id] !== null && srcHash !== seeded[id],
      restorable: !untouched && !!srcHash,
    };
  }
  return out;
}

/** Replaces the user's entry with the bundled default (the caller moves the old one to the trash first if it wants to keep it). */
function restoreBundled(srcDir, destDir, kind, id) {
  if (!isDir(srcDir) || !kind.list(srcDir).includes(id)) throw new Error(`"${id}" is not a bundled default.`);
  fs.mkdirSync(destDir, { recursive: true });
  if (kind.exists(destDir, id)) kind.remove(destDir, id);
  kind.copy(srcDir, destDir, id);
  const seeded = readManifest(destDir);
  seeded[id] = kind.hash(srcDir, id);
  if (kind.baseHash) seeded[DEFAULTS_KEY] = { ...(seeded[DEFAULTS_KEY] || {}), [id]: kind.baseHash(srcDir, id) };
  writeManifest(destDir, seeded);
}

module.exports = {
  bundleStatus,
  copyDir,
  DEFAULTS_KEY,
  MANIFEST,
  readManifest,
  restoreBundled,
  seedBundle,
};
