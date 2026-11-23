// #35 acceptance, written before the code: "a project with no remote (no `repo`) gets a local backlog". Its issues
// live in the workspace, not on a platform: New issue, the Product Owner, Discovery's commit and the roadmap work on
// them as on a synced repository's, and nothing is ever sent to a platform. Until #35 (#25's decision) the engine
// refused: syncBacklog threw "This project has no repository", the Product Owner answered NO_REPOSITORY.
//
// Seams (the service, as backlog-assign-roadmap-446.test.js and discovery-commit-flow-258.test.js drive it):
// - existing: api['projects:create'] (no `repo`), 'projects:update', 'backlog:get', 'backlog:sync', 'backlog:archive',
//   'backlog:assign', 'roadmap:get', 'po:ask' / 'po:file', 'discovery:commit-proposal' / 'discovery:commit';
// - NEW (assumed names, the developer provides them; each test checks the channel exists first):
//   'backlog:create-issue' { projectId, title, body, labels? }, 'backlog:update-issue' { projectId, number, title?, body? },
//   'backlog:close-issue' { projectId, number }: the local issue's New issue / edit / close (written to the workspace,
//   simulation-only too: nothing leaves the machine);
//   'backlog:file-local' { projectId, preview } once a repository was added: files the local issues on the platform
//   on the owner's click; its preview names them and files nothing.
// Every result is read back through 'backlog:get' (never a storage file).
//
// "Nothing is sent to a platform": child_process is observed below, before the engine loads, and any gh / glab call
// or git network call (push, fetch, pull, ls-remote, clone) is recorded and replaced by a process that exits 1.
// (A platform call that fails before spawning, gh not installed, is not seen: it sends nothing either.)
process.env.CRAFTORIO_MOCK_DELAY_SCALE ??= '0.05';
const path = require('path');
const cp = require('child_process');

const sent = [];
const GIT_NETWORK = new Set(['push', 'fetch', 'pull', 'ls-remote', 'clone']);
const cliName = (file) => path.basename(String(file || '')).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
function outbound(file, args) {
  const cli = cliName(file);
  const list = (Array.isArray(args) ? args : []).map(String);
  if (cli === 'gh' || cli === 'glab') return [cli, ...list].join(' ');
  if (cli === 'git' && list.some((a) => GIT_NETWORK.has(a))) return ['git', ...list].join(' ');
  return null;
}
const FAIL = [process.execPath, ['-e', 'process.exit(1)']];
for (const name of ['execFile', 'spawn', 'execFileSync', 'spawnSync']) {
  const real = cp[name];
  cp[name] = function observed(file, args, ...rest) {
    const hit = outbound(file, args);
    if (!hit) return real.call(this, file, args, ...rest);
    sent.push(hit);
    const tail = Array.isArray(args) ? rest : [args, ...rest].filter((x) => x !== undefined);
    return real.call(this, FAIL[0], FAIL[1], ...tail);
  };
}
for (const name of ['exec', 'execSync']) {
  const real = cp[name];
  cp[name] = function observed(command, ...rest) {
    const [file, ...args] = (String(command).match(/"[^"]*"|\S+/g) || []).map((s) => s.replace(/^"|"$/g, ''));
    const hit = outbound(file, args);
    if (!hit) return real.call(this, command, ...rest);
    sent.push(hit);
    return real.call(this, `"${process.execPath}" -e "process.exit(1)"`, ...rest);
  };
}

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const discovery = require('../../domains/discovery/discovery');
const { ISSUE_WORKFLOW, makeService } = require('./helpers');

const REPO = 'https://github.com/o/field-notes';

async function setup(t, name) {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), `service-local-35-${name}-`));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const p = await api['projects:create']({ name: 'field notes', folder });
  sent.length = 0; // only what the test's own actions send
  return { service, api, ws, p };
}

// a new channel the developer adds (its absence fails the test with its name, not a TypeError)
function channel(api, name) {
  assert.equal(typeof api[name], 'function', `the service has the channel ${name}`);
  return api[name];
}

const issuesOf = async (api, projectId) => (await api['backlog:get']({ projectId }))?.issues || [];
const byTitle = (issues, title) => issues.find((i) => i.title === title) || null;
const labelNames = (issue) => (issue?.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

async function createIssue(api, projectId, title, body = 'Steps to reproduce.') {
  await channel(api, 'backlog:create-issue')({ projectId, title, body });
  const issue = byTitle(await issuesOf(api, projectId), title);
  assert.ok(issue, `the Backlog lists "${title}"`);
  return issue;
}

// ---- 1. the local backlog ---------------------------------------------------------------------------

test('#35 backlog:get on a new project with no repository answers an empty local backlog, not null', async (t) => {
  const { api, p } = await setup(t, 'get');
  const data = await api['backlog:get']({ projectId: p.id });
  assert.equal(Array.isArray(data?.issues), true, `backlog:get: ${JSON.stringify(data)}`);
  assert.equal(data.issues.length, 0);
});

test('#35 New issue on a project with no repository: the Backlog lists each new issue open, with its own number', async (t) => {
  const { api, p } = await setup(t, 'create');
  const first = await createIssue(api, p.id, 'Export runs as CSV');
  const second = await createIssue(api, p.id, 'Dark mode for the run log');
  assert.equal(first.state, 'open');
  assert.equal(second.state, 'open');
  assert.equal(Number.isInteger(first.number) && first.number > 0, true, `number: ${first.number}`);
  assert.notEqual(first.number, second.number);
  assert.deepEqual(sent, []);
});

test('#35 editing a local issue changes its title and body in the Backlog', async (t) => {
  const { api, p } = await setup(t, 'edit');
  const issue = await createIssue(api, p.id, 'Export runs as CSV');
  await channel(api, 'backlog:update-issue')({ projectId: p.id, number: issue.number, title: 'Export runs as CSV and JSON', body: 'Both formats.' });
  const edited = (await issuesOf(api, p.id)).find((i) => i.number === issue.number);
  assert.equal(edited?.title, 'Export runs as CSV and JSON');
  assert.equal(edited?.body, 'Both formats.');
  assert.deepEqual(sent, []);
});

test('#35 closing a local issue keeps it in the Backlog, closed', async (t) => {
  const { api, p } = await setup(t, 'close');
  const issue = await createIssue(api, p.id, 'Export runs as CSV');
  await channel(api, 'backlog:close-issue')({ projectId: p.id, number: issue.number });
  const closed = (await issuesOf(api, p.id)).find((i) => i.number === issue.number);
  assert.equal(closed?.state, 'closed');
  assert.deepEqual(sent, []);
});

test('#35 backlog:archive archives a local issue as it does a synced one (closed, label archived), sending nothing', async (t) => {
  const { api, p } = await setup(t, 'archive');
  const issue = await createIssue(api, p.id, 'Export runs as CSV');
  const out = await api['backlog:archive']({ projectId: p.id, numbers: [issue.number] });
  assert.deepEqual(out.results.map((r) => [r.number, r.ok]), [[issue.number, true]]);
  const archived = (await issuesOf(api, p.id)).find((i) => i.number === issue.number);
  assert.equal(archived?.state, 'closed');
  assert.equal(labelNames(archived).includes('archived'), true, `labels: ${JSON.stringify(archived?.labels)}`);
  assert.deepEqual(sent, []);
});

test('#35 backlog:sync on a project with no repository resolves with its local issues and sends nothing', async (t) => {
  const { api, p } = await setup(t, 'sync');
  await createIssue(api, p.id, 'Export runs as CSV');
  sent.length = 0;
  const data = await api['backlog:sync']({ projectId: p.id });
  assert.equal(byTitle(data?.issues || [], 'Export runs as CSV') === null, false, `backlog:sync: ${JSON.stringify(data)}`);
  assert.deepEqual(sent, []);
});

// ---- 2. the Product Owner files into the local backlog ------------------------------------------------

test('#35 the Product Owner\'s draft, filed for real on a project with no repository, lands in the local backlog', async (t) => {
  const { api, p } = await setup(t, 'po');
  // a real filing (simulation-only always previews): the question itself stays simulated (mock: true, no model)
  delete process.env.CRAFTORIO_SIMULATION_ONLY;
  t.after(() => { process.env.CRAFTORIO_SIMULATION_ONLY = '1'; });
  const asked = await api['po:ask']({ projectId: p.id, question: 'Login crashes every time I click save on the settings page', mock: true, mode: 'issue', attachments: [], issues: [] });
  const title = asked?.message?.issue?.draft?.title;
  assert.equal(typeof title, 'string', 'the Product Owner drafted an issue');
  await api['po:file']({ projectId: p.id, at: asked.message.ts, action: 'create', preview: false });
  assert.equal(byTitle(await issuesOf(api, p.id), title) === null, false, `the Backlog lists "${title}"`);
  assert.deepEqual(sent, []);
});

// ---- 3. Discovery's commit and the roadmap ------------------------------------------------------------

function readyCard(dir, projectId) {
  const card = discovery.createCard(dir, projectId, { title: 'Export runs as CSV', text: 'The runs table cannot be exported.' });
  discovery.updateCard(dir, projectId, card.id, { acceptance: '- [ ] Add the CSV writer\n- [ ] Add the Export button', clarity: { score: 90, gaps: [] } });
  discovery.moveCard(dir, projectId, card.id, 'ready', { by: 'tester' });
  return card.id;
}

test('#35 committing a Discovery card on a project with no repository files its issue into the local backlog', async (t) => {
  const { api, ws, p } = await setup(t, 'discovery');
  const cardId = readyCard(ws.discovery, p.id);
  const proposal = await api['discovery:commit-proposal']({ projectId: p.id, cardId });
  const out = await api['discovery:commit']({ projectId: p.id, cardId, split: proposal.split });
  assert.equal(out.card.column, 'committed');
  const filed = byTitle(await issuesOf(api, p.id), 'Export runs as CSV');
  assert.equal(filed?.discoveryCard?.id, cardId);
  assert.deepEqual(sent, []);
});

test('#35 assigning a workflow to a local issue plans it in the roadmap, sending nothing', async (t) => {
  const { api, ws, p } = await setup(t, 'assign');
  fs.writeFileSync(path.join(ws.workflows, 'fixture-issue.yaml'), ISSUE_WORKFLOW);
  const issue = await createIssue(api, p.id, 'Export runs as CSV');
  sent.length = 0;
  await api['backlog:assign']({ projectId: p.id, numbers: [issue.number], workflow: 'fixture-issue.yaml', mock: true });
  const roadmap = api['roadmap:get']({ projectId: p.id });
  const planned = (roadmap?.stages || []).flatMap((s) => s.items || []).flatMap((item) => (item.issues || [item]).map((i) => i.number));
  assert.deepEqual(planned, [issue.number]);
  assert.deepEqual(sent, []);
});

// ---- 5. a repository added later ----------------------------------------------------------------------

test('#35 adding a repository later keeps the local issues in the Backlog and files none of them', async (t) => {
  const { api, p } = await setup(t, 'remote-later');
  await createIssue(api, p.id, 'Export runs as CSV');
  sent.length = 0;
  await api['projects:update']({ id: p.id, patch: { repo: REPO } });
  assert.equal(byTitle(await issuesOf(api, p.id), 'Export runs as CSV') === null, false, 'the local issue is kept');
  assert.deepEqual(sent.filter((c) => /\bissue create\b/.test(c)), [], 'no issue filed on the platform');
});

test('#35 once a repository is added, backlog:file-local\'s preview names the local issues and files nothing', async (t) => {
  const { api, p } = await setup(t, 'file-local');
  await createIssue(api, p.id, 'Export runs as CSV');
  await api['projects:update']({ id: p.id, patch: { repo: REPO } });
  sent.length = 0;
  const out = await channel(api, 'backlog:file-local')({ projectId: p.id, preview: true });
  assert.equal(JSON.stringify(out).includes('Export runs as CSV'), true, `the preview: ${JSON.stringify(out)}`);
  assert.deepEqual(sent.filter((c) => /\bissue create\b/.test(c)), [], 'the preview files nothing');
  assert.equal(byTitle(await issuesOf(api, p.id), 'Export runs as CSV') === null, false, 'the local issue is still listed');
});
