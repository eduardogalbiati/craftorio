// #328 acceptance tests (written before the code): the issues language (settings.language.issues).
// The structure the app writes itself in an issue comes from src/shared/language.js issueHeadings in
// that language: the Product Owner's simulated draft (ask, option `language: { issues }`), its
// filing (createBody through fileDraft: a translated "Related:" line is recognised), the PO split
// (po-split fileSplit, option `issuesLanguage`), Discovery's issues (discovery-commit issueBody,
// option `issuesLanguage`), Findings' File as issue (findings issueOf, option `issuesLanguage`) and a
// new epic's body (epics applyEpic, option `issuesLanguage`; GitHub and GitLab). Never translated:
// checkbox syntax, #n refs, labels. With the setting unset every writer's output is today's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const productOwner = require('../src/product-owner');
const poSplit = require('../src/po-split');
const discoveryCommit = require('../src/discovery-commit');
const findings = require('../src/findings');
const epics = require('../src/epics');

const load = () => require('../src/shared/language');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-issues-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- the Product Owner's simulated draft and its filing -----------------------------------------

// words shared with #7's title ("login", "button", "breaks"): the simulated draft relates it
const BACKLOG = { projectId: 'demo', issues: [{ number: 7, state: 'open', title: 'Login button breaks on mobile', labels: [], body: 'x' }] };
const QUESTION = 'The login button breaks after the session expires on the dashboard screen';

async function draftOf(t, extra = {}) {
  const backlogDir = tmp(t);
  const runsDir = tmp(t);
  const asked = await productOwner.ask({ backlogDir, projectId: 'demo', runsDir, question: QUESTION, data: BACKLOG, mock: true, mode: 'issue', ...extra });
  const open = productOwner.currentDraft(asked.messages);
  return { backlogDir, runsDir, open, body: open.message.issue.draft.body };
}

test('#328 the PO\'s simulated draft in pt-BR uses the pt-BR headings and keeps "- [ ]" and the #n refs', async (t) => {
  const { body } = await draftOf(t, { language: { agents: 'en', issues: 'pt-BR' } });
  assert.match(body, /^## Tarefas$/m);
  assert.match(body, /^Decisão \(owner\): /m);
  assert.match(body, /^Relacionadas: #7$/m);
  assert.match(body, /^- \[ \] /m);
  assert.doesNotMatch(body, /^## Tasks$|^Related:|^Decision \(owner\):/m);
});

test('#328 the PO\'s simulated draft with the setting unset keeps today\'s English headings', async (t) => {
  const { body } = await draftOf(t);
  assert.match(body, /^## Tasks$/m);
  assert.match(body, /^Decision \(owner\): /m);
  assert.match(body, /^Related: #7$/m);
});

test('#328 filing a pt-BR draft: createBody recognises "Relacionadas:" and adds no English "Related:" line', async (t) => {
  const { backlogDir, runsDir, open } = await draftOf(t, { language: { agents: 'en', issues: 'pt-BR' } });
  const res = await productOwner.fileDraft({
    backlogDir, projectId: 'demo', runsDir, at: open.message.ts, action: 'create', preview: true,
    platform: 'github', repo: 'https://github.com/example/repo', issuesLanguage: 'pt-BR',
  });
  assert.doesNotMatch(res.body, /^Related:/m);
  assert.equal((res.body.match(/^Relacionadas:/gm) || []).length, 1);
});

// ---- the PO split ------------------------------------------------------------------------------

const PARENT = { number: 50, title: 'Big issue', state: 'open', labels: [], body: '## Context\n\nWhy.\n\n## Tasks\n\n- [ ] Engine part\n- [x] Renderer part\n' };
const SPLIT = { issue: 50, parent: 'close', children: [
  { title: 'Engine', tasks: [1], complexity: 2, stage: 1 },
  { title: 'Renderer', tasks: [2], complexity: 2, stage: 1 },
] };

async function splitChildren(t, extra = {}) {
  const dir = tmp(t);
  let created = 100;
  const exec = async (cli, args) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'complexity:2' }]);
    if (args[0] === 'issue' && args[1] === 'create') { created += 1; return `https://github.com/o/r/issues/${created}\n`; }
    return '';
  };
  await poSplit.fileSplit({ platform: 'github', repo: 'https://github.com/o/r', parent: PARENT, split: SPLIT, dir, preview: false, exec, ...extra });
  return fs.readdirSync(dir).filter((f) => /split-50-\d\.md$/.test(f)).sort().map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

test('#328 a PO split in pt-BR files children with "## Tarefas", their checkboxes and the parent\'s #n', async (t) => {
  const children = await splitChildren(t, { issuesLanguage: 'pt-BR' });
  assert.equal(children.length, 2);
  assert.match(children[0], /^## Tarefas$/m);
  assert.match(children[0], /^- \[ \] Engine part$/m);
  assert.match(children[1], /^- \[x\] Renderer part$/m);
  assert.match(children[0], /#50\b/);
  assert.doesNotMatch(children[0], /^## Tasks$/m);
});

test('#328 a PO split with the setting unset keeps "## Tasks"', async (t) => {
  const children = await splitChildren(t);
  assert.match(children[0], /^## Tasks$/m);
});

// ---- Discovery: a card committed as issues --------------------------------------------------------

const CARD = { id: 'card-1', title: 'Faster start', document: 'Some evidence.', clarity: { score: 80 } };
const ISSUE = { title: 'Start faster', tasks: ['Cache the list', 'Tests'], complexity: 2 };

test('#328 a Discovery issue in pt-BR uses "## Tarefas" and "Relacionadas:", keeping "- [ ]" and the #n refs', () => {
  const body = discoveryCommit.issueBody({ card: CARD, issue: ISSUE, index: 1, total: 2, siblings: [12], issuesLanguage: 'pt-BR' });
  assert.match(body, /^## Tarefas$/m);
  assert.match(body, /^- \[ \] Cache the list$/m);
  assert.match(body, /^Relacionadas: #12\b/m);
  assert.doesNotMatch(body, /^## Tasks$|^Related:/m);
});

test('#328 a Discovery issue with the setting unset is today\'s', () => {
  const body = discoveryCommit.issueBody({ card: CARD, issue: ISSUE, index: 1, total: 2, siblings: [12] });
  assert.match(body, /^## Tasks$/m);
  assert.match(body, /^Related: #12 \(same discovery card\)\.$/m);
});

// ---- Findings: File as issue -----------------------------------------------------------------------

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const EN_FINDING_HEADINGS = ['## Problem', '## Marks', '## Screen', '## Finding bundle', '## Acceptance criteria'];

function finding(t) {
  const root = tmp(t);
  const ws = { root, findings: path.join(root, 'findings') };
  const saved = findings.saveFinding(ws, { image: PNG, marked: PNG, marks: [], note: 'Retry is broken', context: { view: 'run' } });
  return findings.getFinding(ws, saved.id);
}

const headingsOf = (body) => body.split('\n').filter((l) => l.startsWith('## '));

test('#328 a finding filed in pt-BR: every heading comes from the pt-BR issue headings, the checkboxes stay', (t) => {
  const pt = Object.values(load().issueHeadings('pt-BR')).filter((v) => typeof v === 'string');
  const { body } = findings.issueOf(finding(t), { issuesLanguage: 'pt-BR' });
  const headings = headingsOf(body);
  assert.equal(headings.length, EN_FINDING_HEADINGS.length);
  for (const h of headings) assert.ok(pt.includes(h) || pt.includes(h.slice(3)), `${h} is a pt-BR heading`);
  for (const h of EN_FINDING_HEADINGS) assert.equal(headings.includes(h), false, `${h} is translated`);
  assert.match(body, /^- \[ \] /m);
});

test('#328 a finding filed with the setting unset keeps today\'s English headings', (t) => {
  assert.deepEqual(headingsOf(findings.issueOf(finding(t)).body), EN_FINDING_HEADINGS);
});

// ---- a new epic's body (GitHub, GitLab) ------------------------------------------------------------

const GH_EPIC_BODY = 'The members of this epic are its sub-issues.';
const GL_EPIC_BODY = 'Filed by the Product Owner (#138).';

async function githubEpicBody(t, extra = {}) {
  const dir = tmp(t);
  const exec = async (cli, args) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'epic' }]);
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/99\n';
    return '';
  };
  await epics.applyEpic({ platform: 'github', repo: 'https://github.com/o/r', epic: { title: 'New epic', goal: 'Goal text' }, issues: [], epics: [], dir, preview: false, exec, ...extra });
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.md'));
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

async function gitlabEpicBody(t, extra = {}) {
  const calls = [];
  const exec = async (cli, args) => { calls.push(args); return args[0] === 'issue' && args[1] === 'create' ? 'https://gitlab.com/o/r/-/issues/99\n' : ''; };
  await epics.applyEpic({ platform: 'gitlab', repo: 'https://gitlab.com/o/r', epic: { title: 'New epic', goal: 'Goal text' }, issues: [], epics: [], dir: tmp(t), preview: false, exec, ...extra });
  const create = calls.find((a) => a[0] === 'issue' && a[1] === 'create');
  return create[create.indexOf('--description') + 1];
}

test('#328 a new GitHub epic in pt-BR has no English body line', async (t) => {
  const body = await githubEpicBody(t, { issuesLanguage: 'pt-BR' });
  assert.ok(body.startsWith('Goal text\n\n'), body);
  assert.equal(body.includes(GH_EPIC_BODY), false, body);
  assert.ok(body.replace('Goal text', '').trim().length > 0, 'a translated body line');
});

test('#328 a new GitHub epic with the setting unset keeps today\'s body', async (t) => {
  assert.equal(await githubEpicBody(t), `Goal text\n\n${GH_EPIC_BODY}\n`);
});

test('#328 a new GitLab epic in pt-BR has no English body line', async (t) => {
  const body = await gitlabEpicBody(t, { issuesLanguage: 'pt-BR' });
  assert.equal(body.includes(GL_EPIC_BODY), false, body);
  assert.ok(body.replace('Goal text', '').trim().length > 0, 'a translated body line');
});

test('#328 a new GitLab epic with the setting unset keeps today\'s body', async (t) => {
  assert.equal(await gitlabEpicBody(t), `Goal text\n\n${GL_EPIC_BODY}\n`);
});
