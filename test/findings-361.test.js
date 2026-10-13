// Findings (#361), main-process store: a finding saved to <workspace>/findings/<timestamp>/, its
// context bundle kept to an allow list (never tokens, auth state, file contents or environment
// variables), capped, and the saved findings listed with their status. Tests-first: the module does
// not exist yet.
//
// The interface these tests define:
// - src/findings.js:
//   - saveFinding(ws, { image, marked, marks, note, context, at }) → { id, dir, status: 'saved' }
//     ws: a workspace layout (src/workspace.js; only ws.root is needed). image / marked: the window's
//     capture and the capture with the marks, PNG data URLs ('data:image/png;base64,...'). marks: the
//     marks (circle, box, arrow, freehand, numbered pins with their resolved element), each with an
//     optional note. note: the finding's note. at: a Date (default now) naming the folder.
//     Writes <ws.root>/findings/<id>/ with exactly these files:
//       screenshot.png (image), marked.png (marked), marks.json (the marks), context.json (the
//       bundle), note.md (the note).
//     id: the folder's name, built from `at` (a timestamp; two findings never share a folder).
//     context.json keeps only these keys of `context`: view, tab, project, runIds, window, theme,
//     app ({ version, commit }), actions (the last 50 UI actions), calls (the last 50 service channel
//     calls, with their errors), log (the last 200 lines of the main process log, an array of lines;
//     the input may be a text or an array). Any other key is dropped (token, auth, env, fileContents,
//     ...), at every depth a denied key (token, accessToken, refreshToken, password, secret, apiKey,
//     auth, authorization, cookie, env, fileContents) is dropped, and a string with a token's shape
//     (ghp_/gho_/github_pat_/glpat-/sk- keys, "Bearer <x>") is redacted.
//   - listFindings(ws) → [{ id, dir, at, note, status }], newest first; status 'saved' until the
//     finding is sent to the Product Owner (see test/service/findings-361.test.js); [] when the
//     workspace has none.
// The module is required inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../src/findings');

// a 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const SECRETS = {
  token: 'SECRET-TOKEN-0f3a9c',
  accessToken: 'SECRET-ACCESS-7b21de',
  refresh: 'SECRET-REFRESH-55aa01',
  env: 'SECRET-ENV-VALUE-c0ffee',
  file: 'SECRET-FILE-CONTENTS-beef42',
  nested: 'SECRET-NESTED-ARG-9d9d9d',
  github: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  password: 'SECRET-PASSWORD-123abc',
};

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-361-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root };
}

// The context the renderer and main gather, with secrets slipped in on purpose.
function contextWithSecrets() {
  const actions = Array.from({ length: 80 }, (_, i) => ({ type: i % 2 ? 'click' : 'navigate', target: { testid: `nav-${i}`, run: `run-${i}` }, at: 1000 + i }));
  const calls = Array.from({ length: 80 }, (_, i) => ({ channel: 'runs:list', ok: i % 3 !== 0, error: i % 3 ? null : `failed ${i}`, at: 2000 + i }));
  calls[79].args = { projectId: 'p-1', token: SECRETS.nested };
  const lines = Array.from({ length: 300 }, (_, i) => `log line ${i}`);
  lines[250] = `log line 250 gh auth: using ${SECRETS.github}`;
  return {
    view: 'run',
    tab: 'steps',
    project: 'p-1',
    runIds: ['run-1', 'run-2'],
    window: { width: 1280, height: 800 },
    theme: 'dark',
    app: { version: '1.2.3', commit: 'abc1234' },
    actions,
    calls,
    log: lines.join('\n'),
    token: SECRETS.token,
    auth: { accessToken: SECRETS.accessToken, refreshToken: SECRETS.refresh, user: { id: 'u-1' } },
    env: { GH_TOKEN: SECRETS.env, PATH: '/usr/bin' },
    fileContents: SECRETS.file,
    settings: { password: SECRETS.password },
  };
}

const MARKS = [
  { type: 'pin', n: 1, x: 40, y: 30, note: 'This retry does nothing', element: { empty: false, testid: 'step-retry', view: 'run', tab: 'steps', ids: { run: 'run-1', step: 'develop' }, box: { x: 10, y: 20, width: 100, height: 30 } } },
  { type: 'circle', x: 200, y: 120, r: 30 },
  { type: 'box', x: 300, y: 40, width: 80, height: 20, note: 'Misaligned' },
  { type: 'arrow', from: { x: 10, y: 10 }, to: { x: 60, y: 60 } },
  { type: 'freehand', points: [{ x: 1, y: 1 }, { x: 2, y: 3 }] },
  { type: 'pin', n: 2, x: 900, y: 700, element: { empty: true, x: 900, y: 700, view: 'run', tab: 'steps' } },
];

function save(t, extra = {}) {
  const ws = workspace(t);
  const out = load().saveFinding(ws, { image: PNG, marked: PNG, marks: MARKS, note: 'The Retry button is broken', context: contextWithSecrets(), at: new Date('2026-10-13T10:20:30Z'), ...extra });
  return { ws, out };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('saveFinding writes the PNG, the marked PNG, marks, context and note to <workspace>/findings/<id>/', (t) => {
  const { ws, out } = save(t);
  assert.equal(typeof out.id, 'string');
  assert.ok(out.id.length > 0);
  assert.equal(path.resolve(out.dir), path.resolve(ws.root, 'findings', out.id));
  assert.equal(out.status, 'saved');
  assert.deepEqual(fs.readdirSync(out.dir).sort(), ['context.json', 'marked.png', 'marks.json', 'note.md', 'screenshot.png']);
  for (const png of ['screenshot.png', 'marked.png']) {
    assert.deepEqual([...fs.readFileSync(path.join(out.dir, png)).subarray(0, 4)], PNG_SIGNATURE, `${png} is a PNG`);
  }
  assert.match(fs.readFileSync(path.join(out.dir, 'note.md'), 'utf8'), /The Retry button is broken/);
});

test('marks.json keeps every mark with its note and the pins\' resolved elements', (t) => {
  const { out } = save(t);
  const marks = readJson(path.join(out.dir, 'marks.json'));
  const list = Array.isArray(marks) ? marks : marks.marks;
  assert.deepEqual(list.map((m) => m.type), ['pin', 'circle', 'box', 'arrow', 'freehand', 'pin']);
  assert.equal(list[0].note, 'This retry does nothing');
  assert.equal(list[0].element.testid, 'step-retry');
  assert.equal(list[5].element.empty, true);
});

test('the bundle never holds tokens, auth state, environment variables or file contents (deny list)', (t) => {
  const { out } = save(t);
  for (const name of fs.readdirSync(out.dir)) {
    const text = fs.readFileSync(path.join(out.dir, name), 'latin1');
    for (const [what, secret] of Object.entries(SECRETS)) {
      assert.equal(text.includes(secret), false, `${name} leaks the ${what} secret`);
    }
  }
});

test('context.json keeps only the allowed keys, with the current view, project, runs, window, theme and app version', (t) => {
  const { out } = save(t);
  const ctx = readJson(path.join(out.dir, 'context.json'));
  const allowed = ['actions', 'app', 'calls', 'log', 'project', 'runIds', 'tab', 'theme', 'view', 'window'];
  for (const key of Object.keys(ctx)) assert.ok(allowed.includes(key), `context.json has the key "${key}"`);
  assert.equal(ctx.view, 'run');
  assert.equal(ctx.tab, 'steps');
  assert.equal(ctx.project, 'p-1');
  assert.deepEqual(ctx.runIds, ['run-1', 'run-2']);
  assert.deepEqual(ctx.window, { width: 1280, height: 800 });
  assert.equal(ctx.theme, 'dark');
  assert.equal(ctx.app.version, '1.2.3');
  assert.equal(ctx.app.commit, 'abc1234');
});

test('recent UI actions and service calls are capped at the last 50, calls keeping their errors', (t) => {
  const { out } = save(t);
  const ctx = readJson(path.join(out.dir, 'context.json'));
  assert.equal(ctx.actions.length, 50);
  assert.equal(ctx.actions[0].target.testid, 'nav-30');
  assert.equal(ctx.actions[49].target.testid, 'nav-79');
  assert.equal(ctx.calls.length, 50);
  assert.equal(ctx.calls[0].at, 2030);
  assert.equal(ctx.calls[49].at, 2079);
  assert.equal(ctx.calls.find((c) => c.at === 2031).error, 'failed 31');
});

test('the main process log is capped at its last 200 lines', (t) => {
  const { out } = save(t);
  const ctx = readJson(path.join(out.dir, 'context.json'));
  assert.ok(Array.isArray(ctx.log));
  assert.equal(ctx.log.length, 200);
  assert.equal(ctx.log[0], 'log line 100');
  assert.equal(ctx.log[199], 'log line 299');
});

test('two findings saved in the same second get two folders', (t) => {
  const ws = workspace(t);
  const at = new Date('2026-10-13T10:20:30Z');
  const a = load().saveFinding(ws, { image: PNG, marked: PNG, marks: [], note: 'first', context: {}, at });
  const b = load().saveFinding(ws, { image: PNG, marked: PNG, marks: [], note: 'second', context: {}, at });
  assert.notEqual(a.id, b.id);
  assert.notEqual(path.resolve(a.dir), path.resolve(b.dir));
});

test('listFindings is empty for a workspace without findings', (t) => {
  assert.deepEqual(load().listFindings(workspace(t)), []);
});

test('listFindings lists the saved findings, newest first, with their note and status "saved"', (t) => {
  const ws = workspace(t);
  const older = load().saveFinding(ws, { image: PNG, marked: PNG, marks: [], note: 'older one', context: {}, at: new Date('2026-10-12T08:00:00Z') });
  const newer = load().saveFinding(ws, { image: PNG, marked: PNG, marks: [], note: 'newer one', context: {}, at: new Date('2026-10-13T09:00:00Z') });
  const list = load().listFindings(ws);
  assert.deepEqual(list.map((f) => f.id), [newer.id, older.id]);
  assert.deepEqual(list.map((f) => f.status), ['saved', 'saved']);
  assert.match(list[0].note, /newer one/);
  assert.equal(path.resolve(list[1].dir), path.resolve(older.dir));
});
