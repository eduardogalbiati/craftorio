// Project mockups (#625, Plan & Design › Mockups, D10/D14): the only code that writes a project's mockups,
// in the workspace (<workspace>/mockups/<projectId>/, never the project's repository). Plain synchronous
// functions, the workspace folder first; the folder is its own local git repository (one commit per turn:
// versions, restore and later variants come from git). Layout: kit/ (tokens.css, components.css, kit.json),
// screens/<slug>/ (index.html with a data-mid on every element, meta.json), flows/, refs/<sha256>.<ext>
// (pasted references), chat/<slug>.jsonl (the designer chat, not versioned).
// - projectDir(ws, projectId) (refuses '/', '\', '..' and empty); ensureProject (folders, git init and a
//   first commit, idempotent);
// - createScreen(ws, id, { title, html, source }) → { slug, commit } (slugify, `-2` on a taken slug, ONE commit);
// - listScreens → [{ slug, title, source, createdAt }] by slug; screenHtml(ws, id, slug);
// - saveTurn(ws, id, { slug, html, message }) → { commit, problems } (ONE commit with the request; problems:
//   MockupModel.lintMockup against the kit's tokens, D11);
// - listVersions(ws, id, slug) → [{ commit, message, date }] newest first; restoreVersion → a NEW commit;
// - saveRef(ws, id, { data, ext }) → 'refs/<hex>.<ext>'; appendChat / readChat; writeKit / readKit (null without a kit).
// git and commit are the Documents domain's (./docs.js). Service: fronts/plan/engine/channels/mockups.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MockupModel = require('@multiagent/shared/mockup-model');
const { gitOut } = require('@multiagent/engine/service/common');
const { commit, git } = require('./docs');

const FOLDERS = ['kit', 'screens', 'flows', 'refs', 'chat'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const REF_EXT = /^(png|jpe?g|gif|webp)$/i;
const MANIFEST = 'mockup.json';

function projectDir(workspace, projectId) {
  const id = String(projectId ?? '');
  if (!id || /[\\/]/.test(id) || id.includes('..') || id === '.') throw new Error(`Not a project id: ${id}`);
  return path.join(workspace, 'mockups', id);
}

function ensureProject(workspace, projectId) {
  const dir = projectDir(workspace, projectId);
  for (const f of FOLDERS) fs.mkdirSync(path.join(dir, f), { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) git(dir, ['init', '-q']);
  if (!gitOut(dir, ['rev-parse', '--verify', '-q', 'HEAD'])) {
    fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify({ projectId, createdAt: new Date().toISOString() }, null, 2)}\n`);
    commit(dir, [MANIFEST], `Mockups of ${projectId}`);
  }
  return dir;
}

const rel = (...parts) => parts.join('/');
const screenDir = (dir, slug) => path.join(dir, 'screens', slug);

function checkSlug(slug) {
  const s = String(slug ?? '');
  if (!SLUG.test(s)) throw new Error(`Not a mockup screen: ${s}`);
  return s;
}

function existingScreen(workspace, projectId, slug) {
  const s = checkSlug(slug);
  const dir = projectDir(workspace, projectId);
  if (!fs.existsSync(path.join(screenDir(dir, s), 'index.html'))) throw new Error(`No mockup screen ${s} in ${projectId}`);
  return { dir, slug: s };
}

function createScreen(workspace, projectId, { title, html, source = null } = {}) {
  const dir = ensureProject(workspace, projectId);
  const base = MockupModel.slugify(title);
  let slug = base;
  for (let n = 2; fs.existsSync(screenDir(dir, slug)); n += 1) slug = `${base}-${n}`;
  fs.mkdirSync(screenDir(dir, slug), { recursive: true });
  const meta = { slug, title: String(title || '').trim() || slug, source, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(screenDir(dir, slug), 'index.html'), MockupModel.addMids(html || MockupModel.draftScreen({ title })));
  fs.writeFileSync(path.join(screenDir(dir, slug), 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const sha = commit(dir, [rel('screens', slug, 'index.html'), rel('screens', slug, 'meta.json')], `New screen ${slug}: ${meta.title}`);
  return { slug, commit: sha };
}

function listScreens(workspace, projectId) {
  const root = path.join(projectDir(workspace, projectId), 'screens');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SLUG.test(e.name) && fs.existsSync(path.join(root, e.name, 'index.html')))
    .map((e) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(root, e.name, 'meta.json'), 'utf8')); } catch { meta = {}; }
      return { slug: e.name, title: meta.title || e.name, source: meta.source || null, createdAt: meta.createdAt || null };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function screenHtml(workspace, projectId, slug) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  return fs.readFileSync(path.join(screenDir(dir, s), 'index.html'), 'utf8');
}

function kitTokens(dir) {
  try { return fs.readFileSync(path.join(dir, 'kit', 'tokens.css'), 'utf8'); } catch { return ''; }
}
function kitComponents(dir) {
  try { return fs.readFileSync(path.join(dir, 'kit', 'components.css'), 'utf8'); } catch { return ''; }
}

function writeScreen(dir, slug, html, message) {
  const file = path.join(screenDir(dir, slug), 'index.html');
  const marked = MockupModel.addMids(String(html ?? ''));
  fs.writeFileSync(file, marked);
  const sha = commit(dir, [rel('screens', slug, 'index.html')], message);
  // the kit lint (D11): the screen's own styles against the kit's tokens, no model
  const problems = MockupModel.lintMockup({ html: marked, css: kitComponents(dir), tokens: kitTokens(dir) });
  return { commit: sha, problems };
}

function saveTurn(workspace, projectId, { slug, html, message } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const request = String(message ?? '').trim() || 'Edit';
  return writeScreen(dir, s, html, `${s}: ${request}`);
}

function listVersions(workspace, projectId, slug) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const out = gitOut(dir, ['log', '--format=%H%x1f%s%x1f%cI%x1e', '--', rel('screens', s)]) || '';
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, message, date] = r.split('\x1f');
    return { commit: sha, message, date };
  });
}

function restoreVersion(workspace, projectId, { slug, commit: sha } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  if (!COMMIT.test(String(sha ?? ''))) throw new Error(`Not a version: ${sha}`);
  // the file as it was, byte for byte (git() trims its output)
  const html = execFileSync('git', ['show', `${sha}:${rel('screens', s, 'index.html')}`], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return writeScreen(dir, s, html, `${s}: restore ${String(sha).slice(0, 7)}`);
}

function saveRef(workspace, projectId, { data, ext = 'png' } = {}) {
  const type = String(ext).toLowerCase();
  if (!REF_EXT.test(type)) throw new Error(`Not an image type: ${ext}`);
  const raw = typeof data === 'string' ? data.replace(/^data:[^,]*,/, '') : null;
  const bytes = Buffer.isBuffer(data) ? data : raw !== null ? Buffer.from(raw, 'base64') : Buffer.from(data || []);
  if (!bytes.length) throw new Error('An empty reference image');
  const dir = ensureProject(workspace, projectId);
  const name = rel('refs', `${crypto.createHash('sha256').update(bytes).digest('hex')}.${type}`);
  const file = path.join(dir, ...name.split('/'));
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return name;
}

const chatFile = (dir, slug) => path.join(dir, 'chat', `${checkSlug(slug)}.jsonl`);

function appendChat(workspace, projectId, slug, entry) {
  const dir = ensureProject(workspace, projectId);
  fs.appendFileSync(chatFile(dir, slug), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function readChat(workspace, projectId, slug) {
  let text = '';
  try { text = fs.readFileSync(chatFile(projectDir(workspace, projectId), slug), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function writeKit(workspace, projectId, { tokensCss = '', componentsCss = '', kit = {} } = {}) {
  const dir = ensureProject(workspace, projectId);
  fs.writeFileSync(path.join(dir, 'kit', 'tokens.css'), String(tokensCss));
  fs.writeFileSync(path.join(dir, 'kit', 'components.css'), String(componentsCss));
  fs.writeFileSync(path.join(dir, 'kit', 'kit.json'), `${JSON.stringify(kit || {}, null, 2)}\n`);
  return { commit: commit(dir, ['kit/tokens.css', 'kit/components.css', 'kit/kit.json'], 'Visual kit') };
}

function readKit(workspace, projectId) {
  const dir = projectDir(workspace, projectId);
  if (!fs.existsSync(path.join(dir, 'kit', 'tokens.css'))) return null;
  let kit = {};
  try { kit = JSON.parse(fs.readFileSync(path.join(dir, 'kit', 'kit.json'), 'utf8')); } catch { kit = {}; }
  return { tokensCss: kitTokens(dir), componentsCss: kitComponents(dir), kit };
}

module.exports = {
  appendChat,
  createScreen,
  ensureProject,
  listScreens,
  listVersions,
  projectDir,
  readChat,
  readKit,
  restoreVersion,
  saveRef,
  saveTurn,
  screenHtml,
  writeKit,
};
