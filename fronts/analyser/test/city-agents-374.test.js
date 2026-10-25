// #374: agents at work on the project city, packages/shared/city-agents.js. Pure, dual-loaded like
// packages/shared/city-layout.js (module.exports in Node, window.CityAgents in the browser). Exports:
// - relativePath(file, worktree) → the repo-relative path with forward slashes, or null when the file
//   is outside the worktree. Windows: drive letter case-insensitive, backslashes or slashes in either
//   argument; POSIX; a path already relative stays as is ('./' dropped); a sibling folder sharing the
//   prefix (/home/u/wt2 for /home/u/wt) is outside.
// - touchOf(item) → { tool, kind: 'change'|'read', file } | null for a session.stream item
//   { kind: 'tool_call', name, input }: Edit/Write/MultiEdit (input.file_path) and NotebookEdit
//   (input.notebook_path) change; Read (input.file_path) and Grep (input.path, null without one) read;
//   any other tool or item → null.
// - extractTouches(events, { worktree }) → [{ session_id, agent, step, tool, kind, path, ts }] in
//   event order; session.opened { session_id, session: { agent, step_id } } names a session's agent
//   and step; session.stream { session_id, turn, item } carries the tool calls; touches outside the
//   worktree are dropped.
// - lastTouches(touches) → one entry per session_id, its last touch.
// - trailOf(touches, n = 10) → the last n distinct changed paths (reads ignored), most recent last.
// - collisions(runs [{ id, changed }]) → [{ path, runs }] for each path changed by two runs or more,
//   sorted by path, run ids in input order; a run never collides with itself.
// - placeAgents(layout, agents) with layout = CityLayout.layoutCity(...) and agents = the result of
//   architecture:agents ({ projectId, runs: [{ id, colour, agents, trail, dirty }], collisions }) →
//   { robots: [{ runId, session_id, agent, step, path, at: 'roof'|'door', x, y, z, colour, label }],
//     cranes: [paths], building: [{ path, district }], trails: [{ runId, colour, paths }], collisions }.
//   A change puts the robot on the roof (y = the building's h), a read at the door (y 0); label is
//   '<agent> · <step>'; cranes are the dirty paths the city has; a changed path the layout lacks is a
//   building under construction in the district whose files share the longest folder prefix, and its
//   robot stands in that district.
// - CityReplay(touches) with duration, time, playing, speed (1), play/pause/setSpeed/seek/tick/frame;
//   SPEEDS (includes 1, 2, 4). tick(ms) advances by ms*speed while playing, clamped to duration, and
//   stops playing at the end; seek clamps to [0, duration]; frame() → { time, touches (ts <= start +
//   time), last: lastTouches(those) }.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildModel } = require('@multiagent/shared/architecture-model');

const root = path.join(__dirname, '..', '..', '..');
const FILE = path.join(root, 'packages', 'shared', 'city-agents.js');
const load = () => require('@multiagent/shared/city-agents.js');
const loadLayout = () => require('@multiagent/shared/city-layout.js');
const loadModel = () => require('@multiagent/shared/city-model.js');
const plain = (x) => JSON.parse(JSON.stringify(x));
const EPS = 1e-6;

// ---------- the module ----------

test('#374 city-agents.js loads in Node and, in the browser, defines window.CityAgents', () => {
  const api = load();
  for (const name of ['relativePath', 'touchOf', 'extractTouches', 'lastTouches', 'trailOf', 'collisions', 'placeAgents', 'CityReplay']) {
    assert.equal(typeof api[name], 'function', name);
  }
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'city-agents.js' });
  assert.equal(typeof sandbox.window.CityAgents?.extractTouches, 'function');
  assert.equal(typeof sandbox.window.CityAgents?.CityReplay, 'function');
});

test('#374 city-agents.js is pure: no I/O, no clock, no randomness', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  for (const banned of ["require('fs')", "require('child_process')", "require('net')", "require('http')", "require('https')", 'Date.now', 'new Date()', 'Math.random']) {
    assert.equal(src.includes(banned), false, `city-agents.js uses ${banned}`);
  }
});

// ---------- relativePath ----------

test('#374 relativePath: Windows paths, any drive case, any slash', () => {
  const { relativePath } = load();
  assert.equal(relativePath('C:\\w\\run1\\src\\a.js', 'c:/w/run1'), 'src/a.js');
  assert.equal(relativePath('c:/w/run1/src/deep/b.js', 'C:\\w\\run1\\'), 'src/deep/b.js');
  assert.equal(relativePath('C:\\w\\run1/src\\mixed/c.js', 'C:/w/run1'), 'src/mixed/c.js');
});

test('#374 relativePath: POSIX paths, with or without a trailing slash on the worktree', () => {
  const { relativePath } = load();
  assert.equal(relativePath('/home/u/wt/src/a.js', '/home/u/wt/'), 'src/a.js');
  assert.equal(relativePath('/home/u/wt/src/a.js', '/home/u/wt'), 'src/a.js');
});

test('#374 relativePath: a relative path stays as is, without its ./', () => {
  const { relativePath } = load();
  assert.equal(relativePath('src/a.js', '/home/u/wt'), 'src/a.js');
  assert.equal(relativePath('./src/a.js', '/home/u/wt'), 'src/a.js');
  assert.equal(relativePath('src\\win\\a.js', 'C:/w/run1'), 'src/win/a.js');
});

test('#374 relativePath: outside the worktree, or a sibling folder sharing its prefix, gives null', () => {
  const { relativePath } = load();
  assert.equal(relativePath('/home/u/wt2/x.js', '/home/u/wt'), null);
  assert.equal(relativePath('/etc/passwd', '/home/u/wt'), null);
  assert.equal(relativePath('C:\\other\\x.js', 'C:/w/run1'), null);
  assert.equal(relativePath('C:\\w\\run10\\x.js', 'C:/w/run1'), null);
});

// ---------- touchOf ----------

const call = (name, input) => ({ kind: 'tool_call', name, input });

test('#374 touchOf: Edit, Write, MultiEdit and NotebookEdit change a file', () => {
  const { touchOf } = load();
  assert.deepEqual(plain(touchOf(call('Edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'b' }))), { tool: 'Edit', kind: 'change', file: 'src/a.js' });
  assert.deepEqual(plain(touchOf(call('Write', { file_path: 'src/b.js', content: 'x' }))), { tool: 'Write', kind: 'change', file: 'src/b.js' });
  assert.deepEqual(plain(touchOf(call('MultiEdit', { file_path: 'src/c.js', edits: [] }))), { tool: 'MultiEdit', kind: 'change', file: 'src/c.js' });
  assert.deepEqual(plain(touchOf(call('NotebookEdit', { notebook_path: 'nb/d.ipynb', new_source: 'x' }))), { tool: 'NotebookEdit', kind: 'change', file: 'nb/d.ipynb' });
});

test('#374 touchOf: Read and Grep only look', () => {
  const { touchOf } = load();
  assert.deepEqual(plain(touchOf(call('Read', { file_path: 'src/a.js' }))), { tool: 'Read', kind: 'read', file: 'src/a.js' });
  assert.deepEqual(plain(touchOf(call('Grep', { pattern: 'x', path: 'src/engine/run.js' }))), { tool: 'Grep', kind: 'read', file: 'src/engine/run.js' });
});

test('#374 touchOf: Grep without a path, other tools and other items give null', () => {
  const { touchOf } = load();
  assert.equal(touchOf(call('Grep', { pattern: 'x' })), null);
  assert.equal(touchOf(call('Bash', { command: 'npm test' })), null);
  assert.equal(touchOf(call('Glob', { pattern: '**/*.js' })), null);
  assert.equal(touchOf(call('TodoWrite', { todos: [] })), null);
  assert.equal(touchOf({ kind: 'tool_result', output: 'src/a.js' }), null);
  assert.equal(touchOf({ kind: 'text', text: 'Edit src/a.js' }), null);
});

// ---------- run events ----------

const WT = 'C:\\ws\\worktrees\\run-1';
let seq = 0;
const T0 = Date.parse('2026-10-13T10:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const ev = (s, type, fields = {}) => ({ seq: ++seq, ts: at(s), run_id: 'run-1', type, ...fields });
const tool = (s, sid, name, input) => ev(s, 'session.stream', { session_id: sid, turn: 1, item: call(name, input) });

function events() {
  seq = 0;
  return [
    ev(0, 'workflow.started', { workflow: 'software-development' }),
    ev(1, 'session.opened', { session_id: 's-dev', session: { agent: 'developer', step_id: 'implement', provider: 'claude' } }),
    ev(1, 'session.opened', { session_id: 's-rev', session: { agent: 'reviewer', step_id: 'code_review', provider: 'codex' } }),
    ev(2, 'session.message_sent', { session_id: 's-dev', step_id: 'implement', turn: 1 }),
    tool(3, 's-dev', 'Read', { file_path: `${WT}\\src\\engine\\run.js` }),
    tool(4, 's-dev', 'Bash', { command: 'npm test' }),
    tool(5, 's-dev', 'Edit', { file_path: `${WT}\\src\\engine\\run.js` }),
    tool(6, 's-dev', 'Write', { file_path: 'C:\\elsewhere\\notes.md', content: 'x' }),
    ev(7, 'session.stream', { session_id: 's-dev', turn: 1, item: { kind: 'tool_result', output: 'ok' } }),
    tool(8, 's-dev', 'Write', { file_path: 'c:/ws/worktrees/run-1/src/engine/new.js', content: 'x' }),
    ev(9, 'session.message_sent', { session_id: 's-rev', step_id: 'code_review', turn: 1 }),
    tool(10, 's-rev', 'Grep', { pattern: 'queue', path: `${WT}\\src\\engine\\queue.js` }),
  ];
}

const pick = (t) => ({ session_id: t.session_id, agent: t.agent, step: t.step, tool: t.tool, kind: t.kind, path: t.path, ts: t.ts });

test('#374 extractTouches: the tool calls naming a file, in order, with the session\'s agent and step', () => {
  const touches = load().extractTouches(events(), { worktree: WT });
  assert.deepEqual(plain(touches).map(pick), [
    { session_id: 's-dev', agent: 'developer', step: 'implement', tool: 'Read', kind: 'read', path: 'src/engine/run.js', ts: at(3) },
    { session_id: 's-dev', agent: 'developer', step: 'implement', tool: 'Edit', kind: 'change', path: 'src/engine/run.js', ts: at(5) },
    { session_id: 's-dev', agent: 'developer', step: 'implement', tool: 'Write', kind: 'change', path: 'src/engine/new.js', ts: at(8) },
    { session_id: 's-rev', agent: 'reviewer', step: 'code_review', tool: 'Grep', kind: 'read', path: 'src/engine/queue.js', ts: at(10) },
  ]);
});

test('#374 extractTouches: a file outside the run\'s worktree is dropped; no event gives no touch', () => {
  const { extractTouches } = load();
  const paths = extractTouches(events(), { worktree: WT }).map((t) => t.path);
  assert.equal(paths.includes('notes.md'), false);
  assert.equal(paths.some((p) => /elsewhere/.test(p)), false);
  assert.deepEqual(plain(extractTouches([], { worktree: WT })), []);
});

test('#374 extractTouches: POSIX worktrees too', () => {
  seq = 0;
  const posix = [
    ev(1, 'session.opened', { session_id: 's1', session: { agent: 'developer', step_id: 'implement' } }),
    tool(2, 's1', 'Edit', { file_path: '/home/u/wt/src/a.js' }),
    tool(3, 's1', 'Edit', { file_path: '/home/u/wt2/src/a.js' }),
  ];
  assert.deepEqual(load().extractTouches(posix, { worktree: '/home/u/wt' }).map((t) => t.path), ['src/a.js']);
});

test('#374 lastTouches: one entry per session, its last touch', () => {
  const { extractTouches, lastTouches } = load();
  const last = plain(lastTouches(extractTouches(events(), { worktree: WT })));
  const view = last.map((t) => ({ session_id: t.session_id, agent: t.agent, step: t.step, path: t.path, kind: t.kind, ts: t.ts }))
    .sort((a, b) => a.session_id.localeCompare(b.session_id));
  assert.deepEqual(view, [
    { session_id: 's-dev', agent: 'developer', step: 'implement', path: 'src/engine/new.js', kind: 'change', ts: at(8) },
    { session_id: 's-rev', agent: 'reviewer', step: 'code_review', path: 'src/engine/queue.js', kind: 'read', ts: at(10) },
  ]);
});

// ---------- trailOf ----------

const touch = (p, kind = 'change', s = 0) => ({ session_id: 's1', agent: 'developer', step: 'implement', tool: kind === 'change' ? 'Edit' : 'Read', kind, path: p, ts: at(s) });

test('#374 trailOf: the last 10 distinct changed paths, most recent last', () => {
  const touches = Array.from({ length: 12 }, (_, i) => touch(`src/f${String(i).padStart(2, '0')}.js`, 'change', i));
  assert.deepEqual(load().trailOf(touches), ['src/f02.js', 'src/f03.js', 'src/f04.js', 'src/f05.js', 'src/f06.js', 'src/f07.js', 'src/f08.js', 'src/f09.js', 'src/f10.js', 'src/f11.js']);
});

test('#374 trailOf: a path changed again moves to the end; reads are ignored; n is honoured', () => {
  const { trailOf } = load();
  const touches = [touch('a.js', 'change', 1), touch('b.js', 'change', 2), touch('r.js', 'read', 3), touch('a.js', 'change', 4), touch('c.js', 'read', 5)];
  assert.deepEqual(trailOf(touches), ['b.js', 'a.js']);
  assert.deepEqual(trailOf(touches, 1), ['a.js']);
  assert.deepEqual(trailOf([touch('r.js', 'read')]), []);
});

// ---------- collisions ----------

test('#374 collisions: a path changed by two runs, sorted by path, run ids in input order', () => {
  const out = load().collisions([
    { id: 'r1', changed: ['src/b.js', 'src/a.js'] },
    { id: 'r2', changed: ['src/c.js'] },
    { id: 'r3', changed: ['src/a.js', 'src/b.js', 'src/c.js'] },
  ]);
  assert.deepEqual(plain(out), [
    { path: 'src/a.js', runs: ['r1', 'r3'] },
    { path: 'src/b.js', runs: ['r1', 'r3'] },
    { path: 'src/c.js', runs: ['r2', 'r3'] },
  ]);
});

test('#374 collisions: a run never collides with itself; different files do not collide', () => {
  const { collisions } = load();
  assert.deepEqual(plain(collisions([{ id: 'r1', changed: ['x.js', 'x.js'] }])), []);
  assert.deepEqual(plain(collisions([{ id: 'r1', changed: ['x.js'] }, { id: 'r1', changed: ['x.js'] }])), []);
  assert.deepEqual(plain(collisions([{ id: 'r1', changed: ['x.js'] }, { id: 'r2', changed: ['y.js'] }])), []);
  assert.deepEqual(plain(collisions([])), []);
});

// ---------- placeAgents (on #373's layout) ----------

const hash = (n) => String(n).padStart(2, '0').repeat(20);
const FILES = [
  { path: 'README.md', lines: 4 }, { path: 'docs/a.md', lines: 5 }, { path: 'package.json', lines: 12 },
  { path: 'src/engine/big.js', lines: 400 }, { path: 'src/engine/small.js', lines: 20 },
  { path: 'packages/ui-kit/app.js', lines: 60 }, { path: 'apps/desktop/renderer/views/board.js', lines: 25 },
  { path: 'apps/desktop/renderer/views/list.js', lines: 25 },
];
const facts = () => buildModel({
  head: { commit: hash(1), date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
  files: FILES.map((f) => ({ ...f })), log: `\x01${hash(1)} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
  ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
});
const PLAN = {
  version: 1, project: 'fixture', summary: 'A fixture.', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'x' }, { id: 'ui', name: 'UI', kind: 'commercial', purpose: 'x' }, { id: 'books', name: 'Books', kind: 'library', purpose: 'x' }],
  districts: [
    { id: 'engine', name: 'Engine', zone: 'core', purpose: 'x', include: ['/src/engine/**'], exclude: [] },
    { id: 'views', name: 'Views', zone: 'ui', purpose: 'x', include: ['/apps/desktop/renderer/views/**'], exclude: [] },
    { id: 'renderer', name: 'Renderer', zone: 'ui', purpose: 'x', include: ['/apps/desktop/renderer/**'], exclude: [] },
    { id: 'docs', name: 'Docs', zone: 'books', purpose: 'x', include: ['*.md'], exclude: [] },
    { id: 'root', name: 'Root', zone: 'books', purpose: 'x', include: ['/*'], exclude: [] },
  ],
  landmarks: [], ports: [], evidence: [],
};
const layout = () => loadLayout().layoutCity(loadModel().buildCity({ plan: plain(PLAN), facts: facts() }).model);
const inside = (p, r) => p.x >= r.x - EPS && p.z >= r.z - EPS && p.x <= r.x + r.w + EPS && p.z <= r.z + r.d + EPS;

const agent = (session_id, agentName, step, p, kind, s) => ({ session_id, agent: agentName, step, path: p, kind, ts: at(s) });
const AGENTS = {
  projectId: 'p1',
  runs: [
    {
      id: 'run-1', colour: '#e4572e',
      agents: [agent('s-dev', 'developer', 'implement', 'src/engine/big.js', 'change', 5), agent('s-rev', 'reviewer', 'code_review', 'packages/ui-kit/app.js', 'read', 6)],
      trail: ['src/engine/small.js', 'src/engine/big.js'],
      dirty: ['src/engine/big.js', 'nowhere/gone.js'],
    },
    {
      id: 'run-2', colour: '#4c9be8',
      agents: [agent('s-new', 'developer', 'implement', 'apps/desktop/renderer/views/fresh.js', 'change', 7)],
      trail: ['src/engine/big.js', 'apps/desktop/renderer/views/fresh.js'],
      dirty: [],
    },
  ],
  collisions: [{ path: 'src/engine/big.js', runs: ['run-1', 'run-2'] }],
};

test('#374 placeAgents: a changing agent stands on the roof of its building, a reading one at the door', () => {
  const l = layout();
  const out = plain(load().placeAgents(l, plain(AGENTS)));
  const of = Object.fromEntries(out.robots.map((r) => [r.session_id, r]));
  const big = l.buildings.find((b) => b.path === 'src/engine/big.js');
  assert.equal(of['s-dev'].at, 'roof');
  assert.equal(of['s-dev'].path, 'src/engine/big.js');
  assert.ok(Math.abs(of['s-dev'].y - big.h) < EPS, `robot at y ${of['s-dev'].y}, roof at ${big.h}`);
  assert.ok(inside(of['s-dev'], big), `robot ${of['s-dev'].x},${of['s-dev'].z} on the roof's footprint`);
  assert.equal(of['s-rev'].at, 'door');
  assert.equal(of['s-rev'].path, 'packages/ui-kit/app.js');
  assert.equal(of['s-rev'].y, 0);
});

test('#374 placeAgents: each robot carries its run, its run\'s colour and the label "<agent> · <step>"', () => {
  const out = plain(load().placeAgents(layout(), plain(AGENTS)));
  const view = out.robots.map((r) => ({ runId: r.runId, session_id: r.session_id, agent: r.agent, step: r.step, colour: r.colour, label: r.label }))
    .sort((a, b) => a.session_id.localeCompare(b.session_id));
  assert.deepEqual(view, [
    { runId: 'run-1', session_id: 's-dev', agent: 'developer', step: 'implement', colour: '#e4572e', label: 'developer · implement' },
    { runId: 'run-2', session_id: 's-new', agent: 'developer', step: 'implement', colour: '#4c9be8', label: 'developer · implement' },
    { runId: 'run-1', session_id: 's-rev', agent: 'reviewer', step: 'code_review', colour: '#e4572e', label: 'reviewer · code_review' },
  ]);
});

test('#374 placeAgents: a crane on each dirty building the city has', () => {
  const out = plain(load().placeAgents(layout(), plain(AGENTS)));
  assert.deepEqual([...out.cranes].sort(), ['src/engine/big.js']);
});

test('#374 placeAgents: a changed file the city does not have yet is a building under construction in its district', () => {
  const l = layout();
  const out = plain(load().placeAgents(l, plain(AGENTS)));
  const fresh = out.building.find((b) => b.path === 'apps/desktop/renderer/views/fresh.js');
  assert.ok(fresh, `a new building: ${JSON.stringify(out.building)}`);
  assert.equal(fresh.district, 'views');
  assert.equal(out.building.some((b) => b.path === 'src/engine/big.js'), false, 'a building the city has is not new');
  const robot = out.robots.find((r) => r.session_id === 's-new');
  assert.ok(robot, 'its robot is still placed');
  assert.equal(robot.path, 'apps/desktop/renderer/views/fresh.js');
  const district = l.districts.find((d) => d.id === 'views');
  assert.ok(inside(robot, district), `robot ${robot.x},${robot.z} inside the views district`);
});

test('#374 placeAgents: a new file goes to the district sharing the longest folder prefix', () => {
  const l = layout();
  const agents = { projectId: 'p1', runs: [{ id: 'run-1', colour: '#e4572e', agents: [agent('s1', 'developer', 'implement', 'src/engine/sub/x.js', 'change', 1)], trail: [], dirty: [] }], collisions: [] };
  const out = plain(load().placeAgents(l, agents));
  assert.deepEqual(out.building.map((b) => ({ path: b.path, district: b.district })), [{ path: 'src/engine/sub/x.js', district: 'engine' }]);
  assert.ok(l.districts.some((d) => d.id === out.building[0].district), 'a district of the layout');
});

test('#374 placeAgents: trails per run with its colour, and the collisions passed through', () => {
  const out = plain(load().placeAgents(layout(), plain(AGENTS)));
  assert.deepEqual(out.trails, [
    { runId: 'run-1', colour: '#e4572e', paths: ['src/engine/small.js', 'src/engine/big.js'] },
    { runId: 'run-2', colour: '#4c9be8', paths: ['src/engine/big.js', 'apps/desktop/renderer/views/fresh.js'] },
  ]);
  assert.deepEqual(out.collisions, [{ path: 'src/engine/big.js', runs: ['run-1', 'run-2'] }]);
});

test('#374 placeAgents: no run gives an empty scene', () => {
  const out = plain(load().placeAgents(layout(), { projectId: 'p1', runs: [], collisions: [] }));
  assert.deepEqual(out, { robots: [], cranes: [], building: [], trails: [], collisions: [] });
});

// ---------- CityReplay ----------

// three touches at 0 s, 10 s and 30 s of a finished run
const REPLAY = () => [
  touch('src/a.js', 'read', 0),
  { ...touch('src/a.js', 'change', 10), session_id: 's1' },
  { ...touch('src/b.js', 'change', 30), session_id: 's2', agent: 'reviewer', step: 'code_review' },
];

test('#374 CityReplay: starts paused at 0, at speed 1, over the run\'s duration; SPEEDS includes 1, 2 and 4', () => {
  const { CityReplay, SPEEDS } = load();
  const r = new CityReplay(REPLAY());
  assert.equal(r.duration, 30000);
  assert.equal(r.time, 0);
  assert.equal(r.playing, false);
  assert.equal(r.speed, 1);
  for (const s of [1, 2, 4]) assert.ok([...SPEEDS].includes(s), `SPEEDS has ${s}`);
});

test('#374 CityReplay: tick moves only while playing, at the chosen speed', () => {
  const r = new (load().CityReplay)(REPLAY());
  r.tick(5000);
  assert.equal(r.time, 0, 'paused: no move');
  r.play();
  assert.equal(r.playing, true);
  r.tick(5000);
  assert.equal(r.time, 5000);
  r.setSpeed(2);
  assert.equal(r.speed, 2);
  r.tick(5000);
  assert.equal(r.time, 15000);
  r.pause();
  assert.equal(r.playing, false);
  r.tick(5000);
  assert.equal(r.time, 15000);
});

test('#374 CityReplay: the end clamps the time and stops playing', () => {
  const r = new (load().CityReplay)(REPLAY());
  r.play();
  r.setSpeed(4);
  r.tick(60000);
  assert.equal(r.time, 30000);
  assert.equal(r.playing, false);
});

test('#374 CityReplay: seek moves the time, within the run', () => {
  const r = new (load().CityReplay)(REPLAY());
  r.seek(12000);
  assert.equal(r.time, 12000);
  r.seek(-5);
  assert.equal(r.time, 0);
  r.seek(99999);
  assert.equal(r.time, 30000);
});

test('#374 CityReplay: frame() gives the touches so far and each session\'s last one', () => {
  const r = new (load().CityReplay)(REPLAY());
  const first = plain(r.frame());
  assert.equal(first.time, 0);
  assert.deepEqual(first.touches.map((t) => `${t.kind}:${t.path}`), ['read:src/a.js']);
  r.seek(10000);
  const mid = plain(r.frame());
  assert.equal(mid.time, 10000);
  assert.deepEqual(mid.touches.map((t) => `${t.kind}:${t.path}`), ['read:src/a.js', 'change:src/a.js']);
  assert.deepEqual(mid.last.map((t) => `${t.session_id}:${t.kind}:${t.path}`), ['s1:change:src/a.js']);
  r.seek(30000);
  const end = plain(r.frame());
  assert.deepEqual(end.last.map((t) => `${t.session_id}:${t.path}`).sort(), ['s1:src/a.js', 's2:src/b.js']);
});
