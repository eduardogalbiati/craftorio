// Findings (#361): what the Findings button saves. A finding is a folder
// <workspace>/findings/<id>/ (id: the UTC timestamp, YYYYMMDD-HHMMSS, plus -2, -3... when taken):
//   screenshot.png  the window's capture
//   marked.png      the capture with the marks drawn on it
//   marks.json      the marks (pin, circle, box, arrow, freehand), each with its optional note; a pin
//                   carries the element it resolved to (packages/shared/findings-model.js resolvePin)
//   context.json    the state behind the screen, kept to an allow list (CONTEXT_KEYS), capped
//                   (50 UI actions, 50 service calls, 200 main log lines), denied keys dropped at
//                   every depth and token-shaped strings redacted: never tokens, auth state,
//                   environment variables or file contents
//   note.md         the finding's note
//   filing.json     written once "File as issue" sent it to the Product Owner (status 'sent', then
//                   'filed' with the issue link)
// listFindings gives each one with its status: 'saved', 'sent' or 'filed'.
const fs = require('fs');
const path = require('path');
const Language = require('@multiagent/shared/language');
const { redactBaseline } = require('../../engine/redact-baseline');

const CONTEXT_KEYS = ['actions', 'app', 'calls', 'log', 'project', 'runIds', 'tab', 'theme', 'view', 'window'];
const DENIED_KEYS = new Set([
  'accesstoken',
  'apikey',
  'auth',
  'authorization',
  'cookie',
  'env',
  'filecontents',
  'password',
  'refreshtoken',
  'secret',
  'token',
]);
const DENIED_KEY_SHAPE = /token|secret|password|api[-_]?key|cookie|credential/i;
const MAX_ACTIONS = 50;
const MAX_CALLS = 50;
const MAX_LOG_LINES = 200;
const MAX_DEPTH = 8;
const ID_SHAPE = /^\d{8}-\d{6}(?:-\d+)?$/;

const findingsDir = (ws) => path.join(ws.root, 'findings');

const redact = (s) => redactBaseline(String(s));

const deniedKey = (key) => DENIED_KEYS.has(String(key).toLowerCase()) || DENIED_KEY_SHAPE.test(key);

/** A deep copy of plain data without denied keys, token-shaped strings redacted. */
function scrub(value, depth = 0) {
  if (typeof value === 'string') return redact(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!deniedKey(k) && typeof v !== 'function') out[k] = scrub(v, depth + 1);
  }
  return out;
}

const lastOf = (list, n) => (Array.isArray(list) ? list.slice(-n) : []);

function logLines(log) {
  if (log == null) return [];
  const lines = Array.isArray(log) ? log.map(String) : String(log).split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-MAX_LOG_LINES);
}

/** The context bundle: the allow list only, capped and scrubbed. */
function contextBundle(context = {}) {
  const out = {};
  for (const key of CONTEXT_KEYS) {
    if (context[key] === undefined) continue;
    if (key === 'actions') out.actions = lastOf(context.actions, MAX_ACTIONS);
    else if (key === 'calls') out.calls = lastOf(context.calls, MAX_CALLS);
    else if (key === 'log') out.log = logLines(context.log);
    else if (key === 'app') out.app = { version: context.app?.version ?? null, commit: context.app?.commit ?? null };
    else out[key] = context[key];
  }
  return scrub(out);
}

function pngBuffer(dataUrl, what) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error(`The finding's ${what} is not a PNG data URL`);
  return Buffer.from(m[1], 'base64');
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

function atOf(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null;
}

const seqOf = (id) => Number(/-(\d+)$/.exec(id.slice(15))?.[1] || 1);

/** Claims a new folder for `at`: mkdir fails when it exists, so two saves never share one. */
function claimFolder(ws, at) {
  const base = stamp(at);
  fs.mkdirSync(findingsDir(ws), { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const dir = path.join(findingsDir(ws), id);
    try {
      fs.mkdirSync(dir);
      return { id, dir };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

function saveFinding(ws, { image, marked, marks = [], note = '', context = {}, at = new Date() } = {}) {
  const shot = pngBuffer(image, 'screenshot');
  const drawn = marked ? pngBuffer(marked, 'marked screenshot') : shot;
  const { id, dir } = claimFolder(ws, at instanceof Date ? at : new Date(at));
  fs.writeFileSync(path.join(dir, 'screenshot.png'), shot);
  fs.writeFileSync(path.join(dir, 'marked.png'), drawn);
  fs.writeFileSync(path.join(dir, 'marks.json'), `${JSON.stringify(scrub(Array.isArray(marks) ? marks : []), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'context.json'), `${JSON.stringify(contextBundle(context), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'note.md'), `${redact(note || '').trim()}\n`);
  return { id, dir, status: 'saved' };
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const readJson = (file) => {
  const text = readText(file);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** One finding by id, or null (an id is only a folder name: no path goes through). */
function getFinding(ws, id) {
  const name = String(id || '');
  if (!ID_SHAPE.test(name)) return null;
  const dir = path.join(findingsDir(ws), name);
  if (!fs.existsSync(path.join(dir, 'screenshot.png'))) return null;
  const filing = readJson(path.join(dir, 'filing.json')) || {};
  return {
    id: name,
    dir,
    at: atOf(name),
    note: (readText(path.join(dir, 'note.md')) || '').trim(),
    status: filing.status || 'saved',
    issueUrl: filing.issueUrl || null,
    error: filing.error || null,
    // where "File as issue" sent it: the project and the request's ref in the Product Owner's inbox
    projectId: filing.projectId || null,
    ref: filing.ref || null,
  };
}

/** The saved findings, newest first. */
function listFindings(ws) {
  let names = [];
  try {
    names = fs.readdirSync(findingsDir(ws)).filter((n) => ID_SHAPE.test(n));
  } catch {
    return [];
  }
  names.sort((a, b) => b.slice(0, 15).localeCompare(a.slice(0, 15)) || seqOf(b) - seqOf(a));
  return names.map((n) => getFinding(ws, n)).filter(Boolean);
}

/** Records where a finding went: { status: 'sent' | 'filed' | 'error', projectId, issueUrl, error }. */
function markFiling(ws, id, filing) {
  const found = getFinding(ws, id);
  if (!found) return null;
  const record = { ...filing, at: new Date().toISOString() };
  fs.writeFileSync(path.join(found.dir, 'filing.json'), `${JSON.stringify(scrub(record), null, 2)}\n`);
  return getFinding(ws, id);
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const xy = (p) => `${Math.round(p?.x ?? 0)},${Math.round(p?.y ?? 0)}`;

function markLine(m) {
  const note = m.note ? `: ${m.note}` : '';
  if (m.type !== 'pin') return `- ${m.type[0].toUpperCase()}${m.type.slice(1)} at ${xy(m.from || m.points?.[0] || m)}${note}`;
  const el = m.element || {};
  if (el.empty) return `${m.n}. Pin ${m.n} on empty space at ${xy(m)}${note}`;
  const ids = Object.entries(el.ids || {}).map(([k, v]) => `${k} ${v}`).join(', ');
  const where = [el.view && `view ${el.view}`, el.tab && `tab ${el.tab}`, ids].filter(Boolean).join('; ');
  const box = el.box ? `, box ${el.box.x},${el.box.y} ${el.box.width}×${el.box.height}` : '';
  return `${m.n}. Pin ${m.n} on \`${el.testid || '(no data-testid)'}\` (${where || 'no ids'})${box}${note}`;
}

/** The issue a finding is filed as: { title, body }, naming its folder so a run can read the bundle (headings in issuesLanguage, #328). */
function issueOf(found, { imageUrl = null, issuesLanguage = null } = {}) {
  const h = Language.issueHeadings(issuesLanguage);
  const marks = readJson(path.join(found.dir, 'marks.json')) || [];
  const c = readJson(path.join(found.dir, 'context.json')) || {};
  const first = (found.note || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const title = first ? `UI finding: ${cut(first.trim(), 90)}` : `UI finding ${found.id}`;
  const screen = [
    c.view && `view ${c.view}${c.tab ? ` › ${c.tab}` : ''}`,
    c.project && `project ${c.project}`,
    c.runIds?.length && `runs shown ${c.runIds.join(', ')}`,
    c.window && `window ${c.window.width}×${c.window.height}`,
    c.theme && `${c.theme} theme`,
    c.app && `app ${c.app.version || '?'} (${c.app.commit || 'unknown commit'})`,
  ].filter(Boolean);
  const body = [
    h.problem,
    '',
    found.note || '(no note: see the marks)',
    '',
    h.marks,
    '',
    ...(marks.length ? marks.map(markLine) : ['(none)']),
    '',
    h.screen,
    '',
    screen.length ? screen.join('; ') : '(no context)',
    '',
    imageUrl ? `![Marked screenshot](${imageUrl})` : `Marked screenshot: \`${path.join(found.dir, 'marked.png')}\``,
    '',
    h.bundle,
    '',
    `\`${found.dir}\` (screenshot.png, marked.png, marks.json, context.json, note.md): read it as docs/agents/renderer/findings.md "Reading a finding bundle" says.`,
    '',
    h.criteria,
    '',
    '- [ ] Each marked element shows as the note describes, at the same view and tab (a screenshot of the screen after the fix).',
    '- [ ] A check that fails before the fix reproduces the finding (the view\'s screenshot seed, or a test of the marked element\'s module).',
    '',
  ].join('\n');
  return { title, body };
}

module.exports = {
  CONTEXT_KEYS,
  contextBundle,
  findingsDir,
  getFinding,
  issueOf,
  listFindings,
  markFiling,
  redact,
  saveFinding,
  scrub,
};
