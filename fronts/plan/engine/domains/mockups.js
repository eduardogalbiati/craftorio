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
// #835 (phase 2, docs/agents/storage/mockups.md):
// - applyKitMap(ws, id, { components_css, components, inferences }) → { commit } (components.css,
//   components.html, kit.json with each component's file:line source, ONE commit); promoteToKit(ws, id,
//   { slug, mid, name }) → { commit, component } (inline style → a kit class, its colours → tokens, ONE commit);
// - compareVersions(ws, id, { slug, from, to }) → { before, after, changed } (MockupModel.diffMids);
//   screenAt / attachment (a Discovery card's frozen version: full sha, SVG thumbnail) read through fileAt;
// - variants are the repository's branches (main the base): listVariants → { current, variants },
//   createVariant / switchVariant / keepVariant ({ name }: kept → main, the others deleted);
// - saveFlow → { commit, file: 'flows/<name>.json' } (MockupModel.normalizeFlow), listFlows, readFlow;
// - exportZip(ws, id) → a .zip Buffer (the versioned files of the current variant and an index.html, D12).
// #836 (phase 3, the handoff):
// - freezeVersion(ws, id, { slug, commit }) → { ref: '<slug>@<full sha>', slug, commit, dir }: frozen/<slug>@<sha7>/
//   (index.html and kit/ as they were at that commit, not versioned, no commit): a dev run's `mockup` input;
// - saveCrops(ws, id, { slug, commit, regions: [{ mid, data }] }) → [{ mid, file, name }] (saveRef; a mid
//   missing at that version throws): the cropped images of the Product Owner issues (#258 commit dialog);
// - reviewScreen(ws, id, { slug, axe }) → findings (kind 'kit' from the lint, 'axe' from the given violations).
// git and commit are the Documents domain's (./docs.js). Service: fronts/plan/engine/channels/mockups.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const MockupModel = require('@multiagent/shared/mockup-model');
const { gitOut } = require('@multiagent/engine/service/common');
const { commit, git } = require('./docs');

const FOLDERS = ['kit', 'screens', 'flows', 'refs', 'chat'];
const { SLUG, COMMIT } = MockupModel;
const REF_EXT = /^(png|jpe?g|gif|webp)$/i;
const MANIFEST = 'mockup.json';
const BASE_VARIANT = 'main';
const VARIANT_NAME = 'variant name (lowercase letters, digits and dashes)';
const FLOW_NAME = 'flow name (lowercase letters, digits and dashes)';
const KIT_FILES = ['kit/tokens.css', 'kit/components.css', 'kit/kit.json'];

function projectDir(workspace, projectId) {
  const id = String(projectId ?? '');
  if (!id || /[\\/]/.test(id) || id.includes('..') || id === '.') throw new Error(`Not a project id: ${id}`);
  return path.join(workspace, 'mockups', id);
}

function ensureProject(workspace, projectId) {
  const dir = projectDir(workspace, projectId);
  for (const f of FOLDERS) fs.mkdirSync(path.join(dir, f), { recursive: true });
  // main: the base variant whatever the person's init.defaultBranch (#835); symbolic-ref, not `init -b`
  // (git >= 2.28 only)
  if (!fs.existsSync(path.join(dir, '.git'))) {
    git(dir, ['init', '-q']);
    git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${BASE_VARIANT}`]);
  }
  if (!gitOut(dir, ['rev-parse', '--verify', '-q', 'HEAD'])) {
    fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify({ projectId, createdAt: new Date().toISOString() }, null, 2)}\n`);
    commit(dir, [MANIFEST], `Mockups of ${projectId}`);
  }
  return dir;
}

const rel = (...parts) => parts.join('/');
const screenDir = (dir, slug) => path.join(dir, 'screens', slug);

// a screen's, a variant's or a flow's name (SLUG: no '..', '/' or space); `what` names it in the error
function checkSlug(slug, what = 'mockup screen') {
  const s = String(slug ?? '');
  if (!SLUG.test(s)) throw new Error(`Not a ${what}: ${s}`);
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

// a file as it was in a commit, byte for byte (git() trims its output); a bad sha throws
function fileAt(dir, sha, relPath) {
  if (!COMMIT.test(String(sha ?? ''))) throw new Error(`Not a version: ${sha}`);
  return execFileSync('git', ['show', `${sha}:${relPath}`], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function restoreVersion(workspace, projectId, { slug, commit: sha } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const html = fileAt(dir, sha, rel('screens', s, 'index.html'));
  return writeScreen(dir, s, html, `${s}: restore ${String(sha).slice(0, 7)}`);
}

// #835 Compare: two versions of a screen and the data-mids that changed between them
function compareVersions(workspace, projectId, { slug, from, to } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const before = fileAt(dir, from, rel('screens', s, 'index.html'));
  const after = fileAt(dir, to, rel('screens', s, 'index.html'));
  return { before, after, changed: MockupModel.diffMids(before, after) };
}

// the html of a screen at a frozen version (a Discovery card's attachment)
function screenAt(workspace, projectId, { slug, commit: sha } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  return fileAt(dir, sha, rel('screens', s, 'index.html'));
}

// #835 a mockup version attached to a Discovery card: the full sha (frozen) and an SVG thumbnail
function attachment(workspace, projectId, { slug, commit: sha } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  fileAt(dir, sha, rel('screens', s, 'index.html')); // a bad sha or a screen missing at that version throws
  const full = git(dir, ['rev-parse', '--verify', `${sha}^{commit}`]);
  const title = listScreens(workspace, projectId).find((x) => x.slug === s)?.title || s;
  return {
    projectId,
    slug: s,
    commit: full,
    title,
    name: MockupModel.attachmentName({ slug: s, commit: full }),
    thumbnail: MockupModel.attachmentThumbnail({ title, commit: full }),
  };
}

// #836 a version frozen for a dev run's `mockup` input: frozen/<slug>@<sha7>/ holds the screen's index.html
// and the kit (kit/tokens.css, components.css, kit.json) as they were at that commit; no commit, not
// versioned (later turns, variants or kit changes never touch it); a bad sha throws
function freezeVersion(workspace, projectId, { slug, commit: sha } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const html = fileAt(dir, sha, rel('screens', s, 'index.html'));
  const full = git(dir, ['rev-parse', '--verify', `${sha}^{commit}`]);
  const out = path.join(dir, 'frozen', `${s}@${full.slice(0, 7)}`);
  fs.mkdirSync(path.join(out, 'kit'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  for (const f of KIT_FILES) {
    let text = null;
    try { text = fileAt(dir, full, f); } catch { text = null; } // a version older than the kit has none
    if (text !== null) fs.writeFileSync(path.join(out, ...f.split('/')), text);
  }
  return { ref: `${s}@${full}`, slug: s, commit: full, dir: out };
}

// #836 the regions selected for Product Owner issues: each cropped image saved in refs/ (saveRef), with
// its data-mid checked against the screen AT that version; [{ mid, file, name }] in the regions' order
function saveCrops(workspace, projectId, { slug, commit: sha, regions = [] } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const html = fileAt(dir, sha, rel('screens', s, 'index.html'));
  const short = git(dir, ['rev-parse', '--verify', `${sha}^{commit}`]).slice(0, 7);
  const list = Array.isArray(regions) ? regions : [];
  for (const r of list) if (!elementTag(html, r?.mid)) throw new Error(`No element ${r?.mid} in the screen ${s} at ${short}`);
  return list.map((r) => {
    const ext = (/^data:image\/(\w+)/.exec(typeof r.data === 'string' ? r.data : '') || [])[1] || r.ext || 'png';
    const file = saveRef(workspace, projectId, { data: r.data, ext: ext === 'jpeg' ? 'jpg' : ext });
    return { mid: String(r.mid), file, name: `${s}@${short}-${r.mid}.${file.split('.').pop()}` };
  });
}

// #836 Review this screen, the free part: the kit lint of the current screen (kind 'kit', with the
// element that carries the value when one does) and the given axe violations (kind 'axe'); the layout
// findings come from the model turn (fronts/plan/engine/channels/mockups.js)
function reviewScreen(workspace, projectId, { slug, axe = [] } = {}) {
  const { dir, slug: s } = existingScreen(workspace, projectId, slug);
  const html = fs.readFileSync(path.join(screenDir(dir, s), 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<[a-zA-Z][\w-]*\b[^>]*\bdata-mid\s*=\s*["']([^"']+)["'][^>]*>/g)];
  const kit = MockupModel.lintMockup({ html, css: kitComponents(dir), tokens: kitTokens(dir) }).map((p) => {
    const mid = tags.find((m) => m[0].includes(p.value))?.[1];
    return { kind: 'kit', rule: p.rule, value: p.value, ...(mid ? { mid } : {}), message: `${p.rule}: ${p.value}` };
  });
  const axeFindings = (Array.isArray(axe) ? axe : []).filter((v) => v?.id).map((v) => ({
    kind: 'axe', rule: String(v.id), impact: v.impact || null, nodes: v.nodes ?? null, message: String(v.help || v.description || v.id),
  }));
  return [...kit, ...axeFindings];
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
  // #835 the Kit tab's live gallery follows the catalogue
  fs.writeFileSync(path.join(dir, 'kit', 'components.html'), componentsPage(Array.isArray(kit?.components) ? kit.components : []));
  return { commit: commit(dir, [...KIT_FILES, 'kit/components.html'], 'Visual kit') };
}

function readKit(workspace, projectId) {
  const dir = projectDir(workspace, projectId);
  if (!fs.existsSync(path.join(dir, 'kit', 'tokens.css'))) return null;
  return { tokensCss: kitTokens(dir), componentsCss: kitComponents(dir), kit: kitJson(dir) };
}

function kitJson(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'kit', 'kit.json'), 'utf8')) || {}; } catch { return {}; }
}
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// the kit's component gallery: one section per component (its name, its source, its sample html; without
// one, an element of its class); #c-<slug> anchors one component (the Kit tab's previews)
function componentsPage(components) {
  const { esc } = MockupModel;
  const sample = (c) => c.html || (c.class ? `<div class="${esc(c.class)}">${esc(c.name)}</div>` : '');
  const sections = components.filter((c) => c?.name).map((c) => `<section class="kit-component" id="c-${MockupModel.slugify(c.name)}" data-component="${esc(c.name)}"><h2>${esc(c.name)}</h2>`
    + `${c.source ? `<p class="kit-source">${esc(c.source)}</p>` : ''}<div class="kit-sample">${sample(c)}</div></section>`).join('\n');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Kit components</title>'
    + '<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components.css"></head>'
    + `<body>\n${sections}\n</body></html>\n`;
}

// #835 the ui-kit-map answer: components.css, components.html and kit.json (sources file:line, inferences), ONE commit
function applyKitMap(workspace, projectId, { components_css: css = '', components = [], inferences = [] } = {}) {
  const dir = ensureProject(workspace, projectId);
  const list = (Array.isArray(components) ? components : []).filter((c) => c && String(c.name ?? '').trim()).map((c) => ({
    name: String(c.name).trim(),
    source: c.source ? String(c.source) : null,
    ...(c.class ? { class: String(c.class) } : {}),
    ...(c.html ? { html: String(c.html) } : {}),
  }));
  const tokensFile = path.join(dir, 'kit', 'tokens.css');
  if (!fs.existsSync(tokensFile)) fs.writeFileSync(tokensFile, '');
  fs.writeFileSync(path.join(dir, 'kit', 'components.css'), String(css ?? ''));
  fs.writeFileSync(path.join(dir, 'kit', 'components.html'), componentsPage(list));
  writeJson(path.join(dir, 'kit', 'kit.json'), { ...kitJson(dir), components: list, inferences: (Array.isArray(inferences) ? inferences : []).map(String) });
  return { commit: commit(dir, [...KIT_FILES, 'kit/components.html'], 'Kit map') };
}

// the opening tag of the element marked data-mid="<mid>" in a screen's html, or null
function elementTag(html, mid) {
  const id = String(mid ?? '');
  if (!id) return null;
  const marked = new RegExp(`\\bdata-mid\\s*=\\s*["']${id.replace(/[^\w-]/g, '\\$&')}["']`);
  return [...String(html ?? '').matchAll(/<[a-zA-Z][\w-]*\b[^>]*>/g)].map((m) => m[0]).find((t) => marked.test(t)) || null;
}

// #835 Promote to kit: the element's inline style becomes a kit class, its colours tokens, ONE commit
function promoteToKit(workspace, projectId, { slug, mid, name } = {}) {
  const label = String(name ?? '').trim();
  if (!label) throw new Error('Give the kit component a name.');
  const cls = MockupModel.slugify(label);
  const html = screenHtml(workspace, projectId, slug);
  const id = String(mid ?? '');
  const tag = elementTag(html, id);
  if (!tag) throw new Error(`No element ${id} in the screen ${slug}`);
  const dir = ensureProject(workspace, projectId);
  const style = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
  const tokens = kitTokens(dir);
  const taken = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const added = [];
  const rules = String(style ? style[2] ?? style[3] : '').split(';').map((d) => d.trim()).filter((d) => d.includes(':')).map((d) => {
    const prop = d.slice(0, d.indexOf(':')).trim().toLowerCase();
    const value = d.slice(d.indexOf(':') + 1).trim().replace(MockupModel.COLOR, (color) => {
      let token = `--${cls}-${prop}`;
      for (let n = 2; taken.has(token); n += 1) token = `--${cls}-${prop}-${n}`;
      taken.add(token);
      added.push(`  ${token}: ${color};`);
      return `var(${token})`;
    });
    return `  ${prop}: ${value};`;
  });
  if (added.length) fs.writeFileSync(path.join(dir, 'kit', 'tokens.css'), `${tokens}${tokens && !tokens.endsWith('\n') ? '\n' : ''}:root {\n${added.join('\n')}\n}\n`);
  else if (!fs.existsSync(path.join(dir, 'kit', 'tokens.css'))) fs.writeFileSync(path.join(dir, 'kit', 'tokens.css'), '');
  const css = kitComponents(dir);
  fs.writeFileSync(path.join(dir, 'kit', 'components.css'), `${css}${css && !css.endsWith('\n') ? '\n' : ''}.${cls} {\n${rules.join('\n')}\n}\n`);
  const kit = kitJson(dir);
  const others = (Array.isArray(kit.components) ? kit.components : []).filter((c) => c?.name !== label);
  const component = { name: label, class: cls, source: `screens/${checkSlug(slug)}/index.html#${id}` };
  writeJson(path.join(dir, 'kit', 'kit.json'), { ...kit, components: [...others, component] });
  fs.writeFileSync(path.join(dir, 'kit', 'components.html'), componentsPage([...others, component]));
  return { commit: commit(dir, [...KIT_FILES, 'kit/components.html'], `Promote to kit: ${label} (${slug} ${id})`), component };
}

// ---- variants (#835): the branches of the mockup repository ---------------------------------------

function listVariants(workspace, projectId) {
  const dir = ensureProject(workspace, projectId);
  const names = git(dir, ['branch', '--format=%(refname:short)']).split('\n').map((s) => s.trim()).filter(Boolean);
  return { current: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), variants: names.sort().map((name) => ({ name })) };
}

function createVariant(workspace, projectId, { name } = {}) {
  const n = checkSlug(name, VARIANT_NAME);
  const dir = ensureProject(workspace, projectId);
  if (gitOut(dir, ['rev-parse', '--verify', '-q', `refs/heads/${n}`])) throw new Error(`A variant named ${n} already exists.`);
  git(dir, ['switch', '-q', '-c', n]);
  return listVariants(workspace, projectId);
}

function switchVariant(workspace, projectId, { name } = {}) {
  const n = checkSlug(name, VARIANT_NAME);
  const dir = ensureProject(workspace, projectId);
  if (!gitOut(dir, ['rev-parse', '--verify', '-q', `refs/heads/${n}`])) throw new Error(`No variant named ${n}.`);
  git(dir, ['switch', '-q', n]);
  return listVariants(workspace, projectId);
}

// keep one variant: it becomes main, every other branch is deleted (chat/ is not versioned and stays)
function keepVariant(workspace, projectId, { name } = {}) {
  switchVariant(workspace, projectId, { name });
  const dir = projectDir(workspace, projectId);
  const n = checkSlug(name, VARIANT_NAME);
  for (const v of listVariants(workspace, projectId).variants) if (v.name !== n) git(dir, ['branch', '-D', v.name]);
  if (n !== BASE_VARIANT) git(dir, ['branch', '-m', BASE_VARIANT]);
  return listVariants(workspace, projectId);
}

// ---- flows (#835): flows/<name>.json links an element of a screen to another screen ----------------

function saveFlow(workspace, projectId, flow = {}) {
  const dir = ensureProject(workspace, projectId);
  const clean = MockupModel.normalizeFlow(flow, listScreens(workspace, projectId).map((s) => s.slug));
  const file = rel('flows', `${clean.name}.json`);
  writeJson(path.join(dir, 'flows', `${clean.name}.json`), clean);
  return { commit: commit(dir, [file], `Flow ${clean.name}`), file };
}

function listFlows(workspace, projectId) {
  const root = path.join(projectDir(workspace, projectId), 'flows');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((f) => f.endsWith('.json') && SLUG.test(f.slice(0, -5))).sort().map((f) => ({ name: f.slice(0, -5) }));
}

function readFlow(workspace, projectId, name) {
  const n = checkSlug(name, FLOW_NAME);
  const text = fs.readFileSync(path.join(projectDir(workspace, projectId), 'flows', `${n}.json`), 'utf8');
  return MockupModel.normalizeFlow(JSON.parse(text));
}

// ---- static .zip export (#835, D12) ---------------------------------------------------------------

// a minimal zip (deflate, UTF-8 names): local headers, central directory, end of central directory
function zipBuffer(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const dirBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

// the export's start page: a relative link to every screen and the kit, nothing from the network
function exportIndex(projectId, screens, flows) {
  const { esc } = MockupModel;
  const items = screens.map((s) => `<li><a href="screens/${s.slug}/index.html">${esc(s.title)}</a></li>`).join('\n');
  const flowItems = flows.map((f) => `<li><a href="flows/${f.name}.json">${esc(f.name)}</a></li>`).join('\n');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
    + `<title>Mockups of ${esc(projectId)}</title><link rel="stylesheet" href="kit/tokens.css"><link rel="stylesheet" href="kit/components.css"></head>`
    + `<body><h1>Mockups of ${esc(projectId)}</h1><h2>Screens</h2><ul>\n${items}\n</ul>`
    + `<h2>Kit</h2><ul><li><a href="kit/components.html">Components</a></li></ul>`
    + `${flows.length ? `<h2>Flows</h2><ul>\n${flowItems}\n</ul>` : ''}</body></html>\n`;
}

// the current variant's versioned files (screens, kit, flows, refs; no .git/, no chat/) and an index.html
function exportZip(workspace, projectId) {
  const dir = ensureProject(workspace, projectId);
  const files = git(dir, ['ls-files', '-z']).split('\0').filter((f) => f && f !== 'index.html');
  const entries = files.map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, ...f.split('/'))) }));
  const index = exportIndex(projectId, listScreens(workspace, projectId), listFlows(workspace, projectId));
  return zipBuffer([{ name: 'index.html', data: Buffer.from(index, 'utf8') }, ...entries]);
}

module.exports = {
  appendChat,
  applyKitMap,
  attachment,
  compareVersions,
  createScreen,
  createVariant,
  ensureProject,
  exportZip,
  freezeVersion,
  keepVariant,
  listFlows,
  listScreens,
  listVariants,
  listVersions,
  projectDir,
  promoteToKit,
  readChat,
  readFlow,
  readKit,
  restoreVersion,
  reviewScreen,
  saveCrops,
  saveFlow,
  saveRef,
  saveTurn,
  screenAt,
  screenHtml,
  switchVariant,
  writeKit,
};
