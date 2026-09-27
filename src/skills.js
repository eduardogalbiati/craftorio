// Skills: one folder per skill in <workspace>/skills/<id>/SKILL.md, in the same format
// as Claude Code skills (YAML frontmatter with name/description + Markdown body).

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const yaml = require('js-yaml');
const { slugify } = require('./projects');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseSkill(text) {
  text = String(text).replace(/^\uFEFF/, ''); // BOM from some Windows editors
  const m = text.match(FRONTMATTER);
  let meta = {};
  if (m) { try { meta = yaml.load(m[1]) || {}; } catch { meta = {}; } }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

// `meta` keeps any other frontmatter fields (e.g. `uses`) when the UI saves a skill.
function serializeSkill({ name, description, body, meta = {} }) {
  const fm = yaml.dump({ ...meta, name, description: description || '' }, { lineWidth: -1 }).trimEnd();
  return `---\n${fm}\n---\n\n${String(body || '').trim()}\n`;
}

const skillFile = (dir, id) => path.join(dir, id, 'SKILL.md');

function readSkill(dir, id) {
  const file = skillFile(dir, id);
  const text = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseSkill(text);
  const files = fs.readdirSync(path.join(dir, id)).filter((f) => f !== 'SKILL.md');
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    // other skills this one builds on; the engine injects them first
    uses: Array.isArray(meta.uses) ? meta.uses.map(String) : [],
    meta,
    body,
    path: path.join(dir, id),
    files,
    updatedAt: fs.statSync(file).mtime.toISOString(),
  };
}

function listSkills(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.existsSync(skillFile(dir, d)))
    .map((id) => { try { return readSkill(dir, id); } catch (e) { return { id, name: id, error: e.message }; } })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function createSkill(dir, { name, description, body }) {
  const id = slugify(name);
  if (!String(name || '').trim()) throw new Error('Enter the skill name.');
  if (fs.existsSync(path.join(dir, id))) throw new Error(`A skill "${id}" already exists.`);
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(skillFile(dir, id), serializeSkill({ name: id, description, body }));
  return readSkill(dir, id);
}

function saveSkill(dir, id, { description, body }) {
  const cur = readSkill(dir, id);
  fs.writeFileSync(skillFile(dir, id), serializeSkill({ name: cur.name, description, body, meta: cur.meta }));
  return readSkill(dir, id);
}

// ---------------------------------------------------------------------------
// Use by the agents
// ---------------------------------------------------------------------------
// A skill's support files (e.g. rules/python.md), relative paths with "/".
function supportFiles(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return supportFiles(dir, r);
    return r === 'SKILL.md' || e.name.startsWith('.') ? [] : [r];
  });
}

/** Looks up the skill in the folders in order (workspace before the ones bundled with the app). */
function resolveSkill(dirs, id) {
  const safe = path.basename(String(id || ''));
  for (const dir of dirs.filter(Boolean)) {
    if (fs.existsSync(skillFile(dir, safe))) {
      const skill = readSkill(dir, safe);
      return { ...skill, files: supportFiles(skill.path) };
    }
  }
  throw new Error(`Skill not found: "${id}" (searched in ${dirs.filter(Boolean).join(', ')})`);
}

// Block injected into the agent's prompt. The body goes inline; the support files
// are listed with absolute paths so the agent reads only the relevant ones
// (e.g. the rules for the diff's language), like Claude Code does with skills.
function skillPrompt(skill) {
  const files = skill.files.length
    ? `\n\nSkill support files (read the ones relevant to the task):\n${skill.files.map((f) => `- ${path.join(skill.path, f)}`).join('\n')}`
    : '';
  return `<skill name="${skill.name}" dir="${skill.path}">\n${skill.body.trim()}${files}\n</skill>`;
}

// Copies the skills bundled with the app into the workspace (only missing ones, and only once
// per skill: if the user deletes one, it does not come back). Manual copy because
// fs.cpSync cannot read from inside app.asar.
const SEEDED = '.seeded.json';
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

// Content hash of a skill folder (paths + bytes), used to tell whether the user
// edited a seeded copy.
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  for (const f of supportFiles(dir).concat('SKILL.md').sort()) {
    h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f))).update('\0');
  }
  return h.digest('hex');
}

// .seeded.json maps skill id -> hash of what was copied. For each bundled skill:
// - never seeded and missing          -> copy it
// - seeded, user deleted it           -> leave it deleted
// - seeded, untouched, app has update -> replace it with the new version
// - seeded, edited by the user        -> keep the user's version
// Returns the ids that were copied or updated.
function seedSkills(srcDir, destDir) {
  if (!isDir(srcDir)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const markFile = path.join(destDir, SEEDED);
  let seeded = {};
  try {
    const raw = JSON.parse(fs.readFileSync(markFile, 'utf8').replace(/^\uFEFF/, ''));
    // legacy format: list of ids without hashes (never auto-updated)
    seeded = Array.isArray(raw) ? Object.fromEntries(raw.map((id) => [id, null])) : raw;
  } catch { /* first time */ }
  const changed = [];
  for (const id of fs.readdirSync(srcDir).filter((d) => fs.existsSync(skillFile(srcDir, d)))) {
    const src = path.join(srcDir, id);
    const dest = path.join(destDir, id);
    const srcHash = hashDir(src);
    const exists = fs.existsSync(skillFile(destDir, id));
    if (!(id in seeded)) {
      if (exists) continue; // the user already has a skill with this name
    } else if (!exists || seeded[id] === null || seeded[id] === srcHash || hashDir(dest) !== seeded[id]) {
      continue; // deleted, legacy, already current, or edited by the user
    } else {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDir(src, dest);
    seeded[id] = srcHash;
    changed.push(id);
  }
  fs.writeFileSync(markFile, JSON.stringify(seeded, null, 2));
  return changed;
}

module.exports = { parseSkill, serializeSkill, listSkills, readSkill, createSkill, saveSkill, resolveSkill, skillPrompt, seedSkills };
