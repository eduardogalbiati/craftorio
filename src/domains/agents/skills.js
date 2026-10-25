// Skills: one folder per skill in <workspace>/skills/<id>/SKILL.md, in the same format
// as Claude Code skills (YAML frontmatter with name/description + Markdown body).

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const yaml = require('js-yaml');
const { slugify } = require('../project/projects');
const { seedBundle, copyDir } = require('../seed/seed');

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
      // `reads: [code-review]` (#300): folders of other skills this one points to, read, not injected
      const reads = (Array.isArray(skill.meta.reads) ? skill.meta.reads : []).map(String).flatMap((r) => {
        const found = dirs.filter(Boolean).find((d) => fs.existsSync(skillFile(d, path.basename(r))));
        return found ? [{ name: r, path: path.join(found, path.basename(r)) }] : [];
      });
      return { ...skill, files: supportFiles(skill.path), reads };
    }
  }
  throw new Error(`Skill not found: "${id}" (searched in ${dirs.filter(Boolean).join(', ')})`);
}

// `role_sections: [test_writer]` (#300): a "## Test writer: ..." or "## 2. Test writer: ..." section
// (up to the next "## ") reaches only the agent of that name; "## Evidence and UI reviewer: ..." (#387)
// reaches both; without a reader every section stays.
const sectionRoles = (part) => {
  const m = part.match(/^## (?:\d+\.\s*)?([A-Za-z][A-Za-z ]*):/);
  return m ? m[1].trim().toLowerCase().split(/\s+and\s+/).map((r) => r.replace(/\s+/g, '_')) : [];
};
function readerBody(skill, reader) {
  const roles = Array.isArray(skill.meta?.role_sections) ? skill.meta.role_sections.map(String) : [];
  if (!roles.length || typeof reader !== 'string' || !reader) return skill.body; // also `.map(skillPrompt)`'s index
  return skill.body.split(/^(?=## )/m).filter((part) => {
    const addressed = sectionRoles(part).filter((r) => roles.includes(r));
    return !addressed.length || addressed.includes(reader);
  }).join('');
}

// Block injected into the agent's prompt. The body goes inline; the support files
// are listed with absolute paths so the agent reads only the relevant ones
// (e.g. the rules for the diff's language), like Claude Code does with skills.
// reader: the agent's name, for the skill's role_sections.
function skillPrompt(skill, reader = null) {
  const files = skill.files.length
    ? `\n\nSkill support files (read the ones relevant to the task):\n${skill.files.map((f) => `- ${path.join(skill.path, f)}`).join('\n')}`
    : '';
  const reads = skill.reads?.length
    ? `\n\nFolders of the skills it reads:\n${skill.reads.map((r) => `- ${r.name}: ${r.path}`).join('\n')}`
    : '';
  return `<skill name="${skill.name}" dir="${skill.path}">\n${readerBody(skill, reader).trim()}${files}${reads}\n</skill>`;
}

// Skills bundled with the app are seeded into the workspace (src/domains/seed/seed.js): copied once, untouched
// copies updated when the app ships a new version, edited or deleted ones left alone.
// Content hash of a skill folder (paths + bytes), used to tell whether the user edited a seeded copy.
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  for (const f of supportFiles(dir).concat('SKILL.md').sort()) {
    h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f))).update('\0');
  }
  return h.digest('hex');
}

const SKILL_KIND = {
  list: (dir) => fs.readdirSync(dir).filter((d) => fs.existsSync(skillFile(dir, d))),
  exists: (dir, id) => fs.existsSync(skillFile(dir, id)),
  hash: (dir, id) => hashDir(path.join(dir, id)),
  copy: (srcDir, destDir, id) => copyDir(path.join(srcDir, id), path.join(destDir, id)),
  remove: (dir, id) => fs.rmSync(path.join(dir, id), { recursive: true, force: true }),
};

/** Returns the ids that were copied or updated. */
const seedSkills = (srcDir, destDir) => seedBundle(srcDir, destDir, SKILL_KIND);

module.exports = {
  createSkill,
  listSkills,
  parseSkill,
  readSkill,
  resolveSkill,
  saveSkill,
  seedSkills,
  serializeSkill,
  SKILL_KIND,
  skillPrompt,
};
