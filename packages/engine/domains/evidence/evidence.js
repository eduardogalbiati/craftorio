// A run's screenshots (#146): every image is saved under <run_dir>/evidence/<step>/round-<n>/
// (the step that captured it, its visit) as `<issue>-<screen>-<state>.original.png` (the app on the
// base branch) and/or `.modified.png` (the app with the run's change); a screen that only exists
// with the change has only `modified`, one the change removes only `original`. One index,
// <run_dir>/evidence/manifest.json, lists every image with its step, round, commit, issue, screen,
// state, caption and pair, and marks the final set: the round that captured last (the last round of
// the last step that captured). The folders are the source of truth: the manifest is rebuilt from
// them (writeManifest, by the engine after each step and by scripts/screenshot.js --caption) and
// keeps the captions and commits of earlier builds. It also keeps each screenshots step's outcome
// (`captures`, #185: its new elements, an element only the change adds, and its errors).
//
// Runs recorded before #146 have a flat screenshots/ folder with screenshots.json ([{ path, caption,
// before }]): readEvidence reads them as a single legacy set (no migration of the old folders).
//
// Readers: the service (artifacts:evidence → the Artifacts panel and screen), the engine, the
// pr-screenshots skill (its publish.js reads manifest.json on its own).

const fs = require('fs');
const path = require('path');

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const ROUND = /^round-(\d+)$/;
const SIDES = ['original', 'modified'];
const posix = (p) => String(p).split(path.sep).join('/');

const evidenceRoot = (runDir) => path.join(runDir, 'evidence');
const manifestPath = (runDir) => path.join(evidenceRoot(runDir), 'manifest.json');
const roundDir = (runDir, step, round) => path.join(evidenceRoot(runDir), String(step), `round-${round}`);

// `<issue>-<screen>-<state>.<side>.<ext>` → { key, side, issue, screen, state, named }. The issue is
// the leading number (optional), the state the last part (`default` when there is one part). A file
// without `.original`/`.modified` counts as `modified` (named: false).
function parseShotName(file) {
  const m = /^(.+?)(?:\.(original|modified))?\.(png|jpe?g|gif|webp)$/i.exec(path.basename(String(file)));
  if (!m) return null;
  const key = m[1];
  const parts = key.split('-').filter(Boolean);
  const issue = parts.length > 1 && /^\d+$/.test(parts[0]) ? parts.shift() : null;
  const state = parts.length > 1 ? parts.pop() : 'default';
  return { key, side: (m[2] || 'modified').toLowerCase(), issue, screen: parts.join('-') || key, state, named: !!m[2] };
}

// <run_dir>/evidence/<step>/round-<n> → { step, round }, else null
function roundOf(runDir, dir) {
  const rel = path.relative(evidenceRoot(runDir), dir).split(path.sep);
  const m = rel.length === 2 && ROUND.exec(rel[1]);
  return m && rel[0] && rel[0] !== '..' ? { step: rel[0], round: Number(m[1]) } : null;
}

const listDir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const mtimeOf = (file) => { try { return fs.statSync(file).mtime.toISOString(); } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// Every image under evidence/, relative to the run folder (posix)
function evidenceImages(runDir) {
  const walk = (rel) => listDir(path.join(runDir, rel)).flatMap((e) => {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) return walk(r);
    return IMAGE.test(e.name) ? [posix(r)] : [];
  });
  return walk('evidence');
}

/**
 * The manifest of a run's evidence folder, built from the disk.
 * opts: previous (the last manifest: its captions and commits are kept), captions ({ <rel path>: {
 * caption, commit } } for new or updated images), commit / baseCommit (the commit of a new
 * `modified` / `original` image without one), branch, base (the run's branch and its base).
 */
function buildManifest(runDir, opts = {}) {
  const prev = new Map((opts.previous?.images || []).map((x) => [x.path, x]));
  const captions = opts.captions || {};
  const images = [];
  for (const s of listDir(evidenceRoot(runDir)).filter((e) => e.isDirectory())) {
    for (const r of listDir(path.join(evidenceRoot(runDir), s.name)).filter((e) => e.isDirectory() && ROUND.test(e.name))) {
      const round = Number(ROUND.exec(r.name)[1]);
      for (const f of listDir(path.join(evidenceRoot(runDir), s.name, r.name)).filter((e) => e.isFile() && IMAGE.test(e.name))) {
        const rel = `evidence/${s.name}/${r.name}/${f.name}`;
        const name = parseShotName(f.name);
        const old = prev.get(rel) || {};
        const given = captions[rel] || {};
        images.push({
          path: rel,
          step: s.name,
          round,
          issue: name.issue,
          screen: name.screen,
          state: name.state,
          side: name.side,
          key: name.key,
          caption: given.caption ?? old.caption ?? '',
          commit: given.commit ?? old.commit ?? (name.side === 'original' ? opts.baseCommit : opts.commit) ?? null,
          captured_at: mtimeOf(path.join(runDir, rel)),
          pair: null,
          final: false,
        });
      }
    }
  }
  // rounds in capture order (the newest image of each); the last one is the final set
  const rounds = new Map();
  for (const x of images) {
    const id = `${x.step}/${x.round}`;
    const cur = rounds.get(id) || { step: x.step, round: x.round, captured_at: '' };
    if (String(x.captured_at || '') > cur.captured_at) cur.captured_at = String(x.captured_at || '');
    rounds.set(id, cur);
  }
  const order = [...rounds.values()].sort((a, b) => a.captured_at.localeCompare(b.captured_at) || a.step.localeCompare(b.step) || a.round - b.round);
  const final = order[order.length - 1] || null;
  const rank = new Map(order.map((r, i) => [`${r.step}/${r.round}`, i]));
  const rankOf = (x) => rank.get(`${x.step}/${x.round}`);
  // pairs: the other side of the same name in the same round, else (a round that recaptured only
  // one side) the newest one of an earlier round
  for (const x of images) {
    const others = images.filter((y) => y.key === x.key && y.side !== x.side && rankOf(y) <= rankOf(x));
    const other = others.sort((a, b) => rankOf(b) - rankOf(a))[0];
    x.pair = other ? other.path : null;
    x.final = !!final && x.step === final.step && x.round === final.round;
    if (x.caption === '' && other?.caption) x.caption = other.caption;
  }
  images.sort((a, b) => rankOf(a) - rankOf(b) || a.key.localeCompare(b.key) || SIDES.indexOf(a.side) - SIDES.indexOf(b.side));
  // the screenshots steps' outcomes (#185), one per round, a newer one of the same round replacing it
  const captures = (opts.previous?.captures || []).filter((c) => !(opts.capture && c.step === opts.capture.step && c.round === opts.capture.round));
  if (opts.capture) captures.push(opts.capture);
  return {
    version: 1,
    base: opts.base ?? opts.previous?.base ?? null,
    branch: opts.branch ?? opts.previous?.branch ?? null,
    final: final ? { step: final.step, round: final.round } : null,
    rounds: order.map((r) => ({ ...r, final: r === final })),
    images,
    ...(captures.length ? { captures } : {}),
  };
}

/**
 * A screenshots step's output (packages/engine/engine/screenshot-step.js) as the manifest keeps it (#185):
 * { step, round, taken, screens, message, new_elements: [{ name, caption, selector }], errors:
 * [{ name, caption, side, error }] }; captions: name → the screen's caption.
 */
function captureOf(output, captions = {}) {
  const caption = (name) => captions[name] || '';
  return {
    step: output.folder,
    round: output.round,
    taken: output.taken || 0,
    screens: output.screens || 0,
    message: output.message || '',
    new_elements: (output.new_elements || []).map((x) => ({ name: x.name, caption: caption(x.name), selector: x.selector || null })),
    errors: (output.errors || []).map((x) => ({ name: x.name, caption: caption(x.name), side: x.side || null, error: x.error })),
  };
}

/** Rebuilds <run_dir>/evidence/manifest.json (same opts as buildManifest); null without an evidence folder. */
function writeManifest(runDir, opts = {}) {
  if (!fs.existsSync(evidenceRoot(runDir))) return null;
  const previous = readJson(manifestPath(runDir));
  const m = buildManifest(runDir, { ...opts, previous });
  if (!m.images.length && !previous) return m; // nothing captured yet: no empty manifest
  const text = `${JSON.stringify(m, null, 2)}\n`;
  let old = null;
  try { old = fs.readFileSync(manifestPath(runDir), 'utf8'); } catch { /* first build */ }
  if (old !== text) fs.writeFileSync(manifestPath(runDir), text);
  return m;
}

// A run of before #146: screenshots/ + screenshots.json read as one final set (step "screenshots",
// round 1); `before` is the original of its entry's image. null without images.
function legacyManifest(runDir) {
  const dir = path.join(runDir, 'screenshots');
  const files = listDir(dir).filter((e) => e.isFile() && IMAGE.test(e.name)).map((e) => e.name);
  if (!files.length) return null;
  const list = readJson(path.join(dir, 'screenshots.json'));
  const shots = (Array.isArray(list) ? list : []).filter((s) => s && typeof s.path === 'string');
  const byName = new Map();
  const add = (name, side, caption, pairName) => {
    if (!files.includes(name) || byName.has(name)) return;
    const parsed = parseShotName(name);
    byName.set(name, {
      path: `screenshots/${name}`, step: 'screenshots', round: 1, issue: parsed.issue, screen: parsed.screen, state: parsed.state,
      side, key: parsed.key, caption: caption || '', commit: null, captured_at: mtimeOf(path.join(dir, name)),
      pair: pairName && files.includes(pairName) ? `screenshots/${pairName}` : null, final: true,
    });
  };
  for (const s of shots) {
    const [mod, orig] = [path.basename(s.path), s.before ? path.basename(s.before) : null];
    add(mod, 'modified', s.caption, orig);
    if (orig) add(orig, 'original', s.caption, mod);
  }
  for (const f of files) add(f, 'modified', '', null);
  const images = [...byName.values()];
  return { version: 1, legacy: true, base: null, branch: null, final: { step: 'screenshots', round: 1 }, rounds: [{ step: 'screenshots', round: 1, captured_at: '', final: true }], images };
}

/** A run's evidence: its evidence folder (rebuilt from the disk, not written), else the legacy set, else null. */
function readEvidence(runDir) {
  if (fs.existsSync(evidenceRoot(runDir))) {
    const m = buildManifest(runDir, { previous: readJson(manifestPath(runDir)) });
    if (m.images.length) return m;
  }
  return legacyManifest(runDir);
}

/** Images on disk that the manifest does not list (relative paths): what a check reports as orphans. */
function orphanImages(runDir, manifest = readJson(manifestPath(runDir))) {
  const listed = new Set((manifest?.images || []).map((x) => x.path));
  const flat = listDir(path.join(runDir, 'screenshots')).filter((e) => e.isFile() && IMAGE.test(e.name)).map((e) => `screenshots/${e.name}`);
  return [...evidenceImages(runDir), ...(manifest?.legacy ? [] : flat)].filter((p) => !listed.has(p));
}

module.exports = {
  buildManifest,
  captureOf,
  evidenceRoot,
  legacyManifest,
  manifestPath,
  orphanImages,
  parseShotName,
  readEvidence,
  roundDir,
  roundOf,
  writeManifest,
};
