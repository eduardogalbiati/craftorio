// #477 (SEC-12): Artifacts › Open never runs a program an agent wrote.
// CONTRACT (acceptance tests written before the code):
//   NEW module src/host/open-guard.js exports checkOpenable(filePath, { platform, stat }) →
//     { ok: true }                      a file the OS may open with its default app
//     { ok: false, reason: string }     refused, with a reason (non-empty) the caller answers with
//   - refused by extension, case-insensitive: .exe .cmd .bat .ps1 .vbs .js .jar .app .sh .command
//     .scr .msi .lnk .url .desktop; any other (.md, .png, .pdf, .txt, …) is fine;
//   - on a POSIX platform (platform !== 'win32') a file whose mode has an executable bit
//     (mode & 0o111) is refused; on win32 the mode is ignored;
//   - platform defaults to process.platform; stat(filePath) → { mode } defaults to fs.statSync.
//   main.js's `artifacts:open` and `path:open` call it before shell.openPath and answer its reason
//   (main.js itself is not loaded by the tests).
//   The renderer (src/renderer/views/artifacts/artifacts.js renderArtifactViewer): an artifact of
//   kind 'other' gets no Open action (no data-art-act="open", no "Open" button in the body), only
//   the reveal one (shell.showItemInFolder); other kinds keep Open.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox.js');

// resolved inside each test: the module does not exist until the change lands
const load = () => {
  const m = require('../src/host/open-guard.js');
  assert.equal(typeof m.checkOpenable, 'function', 'src/host/open-guard.js exports checkOpenable (#477)');
  return m;
};

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-guard-477-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = (name, mode = 0o644) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x\n');
    fs.chmodSync(p, mode);
    return p;
  };
  return { file };
}

const NOT_EXEC = () => ({ mode: 0o100644 });
const EXEC = () => ({ mode: 0o100755 });

test('#477 checkOpenable: a .cmd file is refused, with a reason', (t) => {
  const { checkOpenable } = load();
  const r = checkOpenable(scratch(t).file('x.cmd'), { platform: 'win32' });
  assert.equal(r.ok, false);
  assert.equal(typeof r.reason, 'string');
  assert.equal(r.reason.length > 0, true);
});

test('#477 checkOpenable: a markdown file opens', (t) => {
  const { checkOpenable } = load();
  assert.equal(checkOpenable(scratch(t).file('x.md'), { platform: 'win32' }).ok, true);
});

test('#477 checkOpenable: every executable extension is refused, whatever its case', (t) => {
  const { checkOpenable } = load();
  const s = scratch(t);
  const exts = ['.exe', '.cmd', '.bat', '.ps1', '.vbs', '.js', '.jar', '.app', '.sh', '.command', '.scr', '.msi', '.lnk', '.url', '.desktop', '.EXE', '.Cmd'];
  const opened = exts.filter((ext) => checkOpenable(s.file(`f${ext}`), { platform: 'win32', stat: NOT_EXEC }).ok !== false);
  assert.deepEqual(opened, []);
});

test('#477 checkOpenable: a document or an image opens (md, png, pdf, txt)', (t) => {
  const { checkOpenable } = load();
  const s = scratch(t);
  const refused = ['x.md', 'x.png', 'x.pdf', 'x.txt'].filter((n) => checkOpenable(s.file(n), { platform: 'linux', stat: NOT_EXEC }).ok !== true);
  assert.deepEqual(refused, []);
});

test('#477 checkOpenable: on POSIX a file with the executable bit is refused, whatever its name', (t) => {
  const { checkOpenable } = load();
  const r = checkOpenable(scratch(t).file('report'), { platform: 'linux', stat: EXEC });
  assert.equal(r.ok, false);
  assert.equal(typeof r.reason, 'string');
});

test('#477 checkOpenable: on Windows the executable bit is ignored', (t) => {
  const { checkOpenable } = load();
  assert.equal(checkOpenable(scratch(t).file('report.txt'), { platform: 'win32', stat: EXEC }).ok, true);
});

test('#477 checkOpenable: a real chmod +x file is refused (default stat)', { skip: process.platform === 'win32' && 'no executable bit on Windows' }, (t) => {
  const { checkOpenable } = load();
  const r = checkOpenable(scratch(t).file('run-me', 0o755), { platform: process.platform });
  assert.equal(r.ok, false);
});

// ---- the renderer: kind 'other' has no Open action -----------------------------------------------

const renderSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'artifact-render.js'), 'utf8');
const artifactsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'artifacts', 'artifacts.js'), 'utf8');

function extract(name, re, src = artifactsSrc) {
  const m = re.exec(src);
  assert.ok(m, `${name} not found: the source moved`);
  return m[0];
}

// renders the viewer for one artifact; returns the toolbar's and the body's markup (strings)
function renderViewer(doc, { mode = 'source' } = {}) {
  const bar = { innerHTML: '', classList: { add() {}, remove() {} }, querySelectorAll: () => [], querySelector: () => ({ textContent: '' }) };
  const body = { innerHTML: '', scrollTop: 0, querySelector: () => ({}), querySelectorAll: () => [] };
  const files = new Map([['r1', { files: [{ path: doc.path, name: path.basename(doc.path), kind: doc.kind, exists: true }] }]]);
  const sandbox = {
    state: { art: { doc, mode, files } },
    $: (sel) => (sel === '#art-toolbar' ? bar : sel === '#art-body' ? body : {}),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    api: { openArtifact: async () => '', clipboardWrite: async () => true },
    errMsg: (e) => String(e?.message || e),
    runIdOfPath: () => 'r1',
    renderMarkdownDoc: () => {},
    renderJsonText: (s) => s,
    renderDelimited: (s) => s,
    ImageViewer: { THUMB: '' },
    ArtifactMenu: { open() {} },
    ArtifactsPanel: { openImage() {} },
    CSS: { escape: (s) => s },
    document: { querySelectorAll: () => [] },
  };
  const code = [
    extract('ART_KIND', /const ART_KIND = \{[^\n]+\};/, renderSrc),
    extract('artKindIcon', /const artKindIcon = [^\n]+/, renderSrc),
    extract('findArtifactMeta', /function findArtifactMeta\(path\) \{[\s\S]*?\n\}/),
    extract('artifactRunOf', /function artifactRunOf\(path\) \{[\s\S]*?\n\}/),
    extract('renderArtifactViewer', /function renderArtifactViewer\(\) \{[\s\S]*?\n\}/),
    'renderArtifactViewer();',
  ].join('\n');
  vm.createContext(withI18n(sandbox));
  vm.runInContext(code, sandbox);
  return { toolbar: String(bar.innerHTML), body: String(body.innerHTML) };
}

// the buttons of some markup: [{ attrs, label }]
const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], label: m[2].replace(/<[^>]*>/g, '').trim() }));

const OTHER = { path: path.join(os.tmpdir(), 'r1', 'setup.cmd'), kind: 'other', exists: true, binary: false, text: null };
const MARKDOWN = { path: path.join(os.tmpdir(), 'r1', 'report.md'), kind: 'markdown', exists: true, binary: false, text: '# Report' };

test('#477 viewer: an artifact of kind "other" has no Open action, in the toolbar or the body', () => {
  const { toolbar, body } = renderViewer(OTHER);
  const all = [...buttons(toolbar), ...buttons(body)];
  assert.deepEqual(all.filter((b) => /data-art-act="open"/.test(b.attrs)).map((b) => b.label), []);
  assert.deepEqual(all.filter((b) => b.label === 'Open').map((b) => b.attrs.trim()), []);
});

test('#477 viewer: an artifact of kind "other" keeps a reveal action (shown in its folder)', () => {
  const { toolbar } = renderViewer(OTHER);
  assert.equal(buttons(toolbar).some((b) => /data-art-act="reveal"/.test(b.attrs)), true, toolbar);
});

test('#477 viewer: a markdown artifact still has its Open action (guard)', () => {
  const { toolbar } = renderViewer(MARKDOWN);
  assert.deepEqual(buttons(toolbar).filter((b) => /data-art-act="open"/.test(b.attrs)).map((b) => b.label), ['Open']);
});

// ---- checkOpenable edges (review 1) ----------------------------------------------------------

test('#477 checkOpenable: what Windows also runs on open (.com .py .hta) is refused', (t) => {
  const { checkOpenable } = load();
  const s = scratch(t);
  const opened = ['x.com', 'x.py', 'x.hta', 'x.PYW', 'x.reg'].filter((n) => checkOpenable(s.file(n), { platform: 'win32' }).ok !== false);
  assert.deepEqual(opened, []);
});

test('#477 checkOpenable: on POSIX a file that cannot be read is refused with a reason', () => {
  const { checkOpenable } = load();
  const missing = () => { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; };
  const r = checkOpenable('/nowhere/notes.md', { platform: 'linux', stat: missing });
  assert.equal(r.ok, false);
  assert.match(r.reason, /ENOENT/);
});

test('#477 checkOpenable: on POSIX a folder opens although its mode has x bits (path:open)', () => {
  const { checkOpenable } = load();
  const folder = () => ({ mode: 0o40755, isDirectory: () => true });
  assert.equal(checkOpenable('/home/me/project', { platform: 'linux', stat: folder }).ok, true);
});

test('#477 checkOpenable: an .app bundle stays refused although it is a folder', () => {
  const { checkOpenable } = load();
  const folder = () => ({ mode: 0o40755, isDirectory: () => true });
  assert.equal(checkOpenable('/Users/me/run/notes.app', { platform: 'darwin', stat: folder }).ok, false);
});
