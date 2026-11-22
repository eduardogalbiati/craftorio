// #794: the repository workflows waiting for an acceptance: the orange count in the sidebar, on the
// collapsed Workflows group and on the Definitions tab, and the highlighted block on top of the
// Definitions tab (fronts/build/views/workflows/workflows.js). Acceptance tests, written before the
// code, through the whole page (test/agent-chat-page-harness.js, like
// test/renderer-workflows-repository-485.test.js).
//
// Seams (what these tests assume):
//   - The count reads api.listWorkflows({ projectId: <current project>, repositoryOnly: true }); an
//     entry counts when `accepted === false`. Accepted entries, { origin: 'manifest' } entries (no
//     accepted field) and the manifest's error entry do not count.
//   - Sidebar: [data-testid="nav-workflows-acceptance"] inside
//     .nav-item[data-view="workflows"][data-tab="definitions"], classes nav-badge and warn. Its text is
//     the count, its title holds the count and names every waiting workflow. With none it is absent or
//     has the class hidden.
//   - Group: [data-testid="nav-group-workflows-acceptance"] inside the Workflows group's title: while
//     the group is collapsed it shows the same count and title (the expanded state is not asserted).
//   - Tab: [data-testid="workflows-tab-acceptance"] inside the screen's [data-wtab="definitions"] tab.
//   - Screen: [data-testid="workflows-awaiting-acceptance"] on top of #workflows-list, present only with
//     waiting workflows, holding their [data-testid="repository-workflow"] cards (class
//     awaiting-acceptance), each once on the page. Inside a waiting card:
//     [data-testid="workflow-acceptance"] (class orange, "not accepted"), [data-testid="workflow-accept"]
//     (class orange) and [data-testid="workflow-acceptance-reason"], the words and the short sha of the
//     entry's changedCommit (the commit that last changed the file; `commit` stays HEAD, what Accept sends).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle, deferred } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const HEAD = 'abc1234def5678901234567890abcdef12345678';
const CHANGED = 'c0ffee1aa5678901234567890abcdef123456789';
const ACCEPTED = '9876543fedcba9876543210fedcba9876543210f';
const base = { description: '', tags: [], inputs: {}, outputs: {}, agents: {}, providers: {}, groups: [], warnings: [], steps: [{ id: 'work', type: 'agent', agent: 'a', skills: [], next: [], transitions: [] }] };
const WORKSPACE = [
  { ...base, file: 'backlog-refresh.yaml', name: 'backlog-refresh', category: 'intake', origin: 'default' },
  { ...base, file: 'feature.yaml', name: 'software-development-local-hero', category: 'solo', origin: 'default' },
];
const PROJECTS = [
  { id: 'p1', name: 'demo', folder: 'C:/demo', repo: true },
  { id: 'p2', name: 'other', folder: 'C:/other', repo: true },
];

const repository = (name, over = {}) => ({ ...base, file: `workflows/${name}.yaml`, name, category: 'solo', origin: 'repository', projectId: 'p1', commit: HEAD, ...over });
const waiting = (name, over = {}) => repository(name, { accepted: false, changedCommit: CHANGED, acceptedCommit: ACCEPTED, diff: '', ...over });
const accepted = (name, over = {}) => repository(name, { accepted: true, category: 'team', ...over });
// the entries that never count, whatever else the project lists
const NOT_COUNTED = [
  accepted('kept-flow'),
  { name: 'write-doc', category: 'team', origin: 'manifest', projectId: 'p1' },
  { file: 'project.yaml', name: '.multiagent/project.yaml', origin: 'repository', projectId: 'p1', error: 'bad', steps: [] },
];

// what the engine says: `table` (per project) is mutable, so a test changes it under the page
const engine = (table) => ({
  listProjects: async () => PROJECTS,
  listPipelines: async () => [],
  listWorkflows: async (opts) => (opts?.repositoryOnly ? table[opts.projectId] || [] : WORKSPACE),
});
const open = (table, extra = {}) => loadPage({ api: { ...engine(table), ...extra } });
async function definitions(table, extra = {}) {
  const page = await open(table, extra);
  page.run("showWorkflowsTab('definitions'); showView('workflows')");
  await settle(30);
  return page;
}

const SIDEBAR = '.nav-item[data-view="workflows"][data-tab="definitions"] [data-testid="nav-workflows-acceptance"]';
const GROUP = '.nav-group[data-group="workflows"] .nav-group-title [data-testid="nav-group-workflows-acceptance"]';
const TAB = '[data-wtab="definitions"] [data-testid="workflows-tab-acceptance"]';
const BLOCK = '#workflows-list [data-testid="workflows-awaiting-acceptance"]';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
// the text an element shows; null when it is absent or hidden
const shown = (el) => (el === null || el.classList.contains('hidden') ? null : norm(textOf(el)));
const titleOf = (page, selector) => { const el = page.$(selector); return el === null ? '' : String(el.title); };
const collapse = async (page) => { page.$('.nav-group[data-group="workflows"] .nav-group-title').click(); await settle(10); };
const allCards = (page, name) => page.document.querySelectorAll('#workflows-list [data-testid="repository-workflow"]').filter((c) => textOf(c).includes(name));
const waitingCard = (page, name) => {
  const block = page.$(BLOCK);
  if (block === null) return null;
  return block.querySelectorAll('[data-testid="repository-workflow"]').find((c) => textOf(c).includes(name)) || null;
};
const sectionCard = (page, category, name) => page.document
  .querySelectorAll(`#workflows-list [data-testid="workflow-category"][data-category="${category}"] [data-testid="repository-workflow"]`)
  .find((c) => textOf(c).includes(name)) || null;
const accept = async (page, name) => { allCards(page, name)[0].querySelector('[data-testid="workflow-accept"]').click(); await settle(30); };
// the fake engine records an acceptance: the entry is then accepted
const acceptIn = (table) => ({
  acceptWorkflow: async ({ projectId, file }) => {
    table[projectId] = table[projectId].map((w) => (w.file === file ? { ...w, accepted: true, acceptedCommit: w.commit, diff: '' } : w));
    return true;
  },
});
const fireEvent = (page, ev) => { for (const fn of page.handlers.onEvent || []) fn(ev); };
const focusWindow = (page) => page.sandbox.dispatchEvent(new page.dom.classes.Event('focus'));
// the refresh after a merge comes up to 1.5 s later (app.js runEventEffects): a bounded wait, real time
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return fn();
}

// ---- the sidebar's count -------------------------------------------------------------------------

test('#794 the sidebar shows no count when nothing waits (accepted, manifest and manifest error entries do not count)', async () => {
  const page = await open({ p1: NOT_COUNTED });
  assert.equal(shown(page.$(SIDEBAR)), null);
});

test('#794 the sidebar counts one waiting workflow, and only it among the entries that do not count', async () => {
  const page = await open({ p1: [waiting('flow-alpha'), ...NOT_COUNTED] });
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

test('#794 the sidebar counts several waiting workflows', async () => {
  const page = await open({ p1: [waiting('flow-alpha'), waiting('flow-beta')] });
  assert.equal(shown(page.$(SIDEBAR)), '2');
});

test('#794 the sidebar count\'s title holds the count and names every waiting workflow', async () => {
  const page = await open({ p1: [waiting('flow-alpha'), waiting('flow-beta'), accepted('kept-flow')] });
  const title = titleOf(page, SIDEBAR);
  assert.match(title, /\b2\b/);
  assert.equal(title.includes('flow-alpha'), true, title);
  assert.equal(title.includes('flow-beta'), true, title);
  assert.equal(title.includes('kept-flow'), false, title);
});

test('#794 the count is there from the start, without opening the Workflows screen', async () => {
  const page = await open({ p1: [waiting('flow-alpha')] });
  assert.equal(page.run('state.view') === 'workflows', false, 'the Workflows screen was not opened');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

test('#794 the sidebar count is an orange badge (nav-badge warn)', async () => {
  const page = await open({ p1: [waiting('flow-alpha')] });
  const el = page.$(SIDEBAR);
  assert.equal(el !== null, true, 'the indicator');
  assert.equal(el.classList.contains('nav-badge'), true, 'nav-badge');
  assert.equal(el.classList.contains('warn'), true, 'warn');
});

test('#794 a failed read leaves the count hidden and the page without errors', async () => {
  const left = [];
  const onRejection = (e) => { if (String(e?.message).includes('read failed')) left.push(String(e.message)); };
  process.on('unhandledRejection', onRejection);
  try {
    const page = await open({}, { listWorkflows: async (opts) => { if (opts?.repositoryOnly) throw new Error('read failed'); return WORKSPACE; } });
    await settle(10);
    const asked = page.callsTo('listWorkflows').filter(([opts]) => opts?.repositoryOnly && opts.projectId === 'p1').length;
    assert.equal(asked > 0, true, 'the current project was read');
    assert.equal(shown(page.$(SIDEBAR)), null);
    assert.equal(page.errors.length, 0);
    assert.equal(left.length, 0, 'the failure is handled');
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

// ---- the current project -------------------------------------------------------------------------

const chooseProject = async (page, id) => {
  const select = page.$('#header-project');
  select.value = id;
  select.onchange({ target: { value: id } });
  await settle(30);
};

test('#794 choosing another project in the header makes the count follow it', async () => {
  const page = await open({ p1: [waiting('flow-alpha')], p2: [waiting('flow-beta'), waiting('flow-gamma')] });
  assert.equal(shown(page.$(SIDEBAR)), '1', 'p1 first');
  await chooseProject(page, 'p2');
  assert.equal(shown(page.$(SIDEBAR)), '2');
  assert.equal(titleOf(page, SIDEBAR).includes('flow-alpha'), false, 'no longer names p1\'s');
});

test('#794 the count hides when the project chosen has nothing waiting', async () => {
  const page = await open({ p1: [waiting('flow-alpha')], p2: [accepted('kept-flow', { projectId: 'p2' })] });
  assert.equal(shown(page.$(SIDEBAR)), '1', 'p1 first');
  await chooseProject(page, 'p2');
  assert.equal(shown(page.$(SIDEBAR)), null);
});

test('#794 a project change that draws nothing still updates the count', async () => {
  const page = await open({ p1: [waiting('flow-alpha')], p2: [waiting('flow-beta'), waiting('flow-gamma')] });
  assert.equal(shown(page.$(SIDEBAR)), '1', 'p1 first');
  page.run("CurrentProject.set('p2', { redraw: false })");
  await settle(30);
  assert.equal(shown(page.$(SIDEBAR)), '2');
});

test('#794 a slow reply of the previous project does not overwrite the current project\'s count', async () => {
  const slow = deferred();
  const table = { p1: [waiting('flow-alpha')], p2: [waiting('flow-beta'), waiting('flow-gamma')] };
  let p1Asked = false;
  const page = await open(table, {
    listWorkflows: async (opts) => {
      if (!opts?.repositoryOnly) return WORKSPACE;
      if (opts.projectId !== 'p1') return table[opts.projectId];
      p1Asked = true;
      await slow.promise;
      return table.p1;
    },
  });
  assert.equal(p1Asked, true, 'p1 was asked and has not answered');
  await chooseProject(page, 'p2');
  assert.equal(shown(page.$(SIDEBAR)), '2', 'p2 answered first');
  slow.resolve();
  await settle(30);
  assert.equal(shown(page.$(SIDEBAR)), '2');
});

// ---- the collapsed group -------------------------------------------------------------------------

test('#794 a collapsed Workflows group shows the count', async () => {
  const page = await open({ p1: [waiting('flow-alpha'), waiting('flow-beta')] });
  await collapse(page);
  assert.equal(shown(page.$(GROUP)), '2');
});

test('#794 a collapsed Workflows group\'s count has the same title', async () => {
  const page = await open({ p1: [waiting('flow-alpha'), waiting('flow-beta')] });
  await collapse(page);
  const title = titleOf(page, GROUP);
  assert.match(title, /\b2\b/);
  assert.equal(title.includes('flow-alpha'), true, title);
  assert.equal(title.includes('flow-beta'), true, title);
});

test('#794 a collapsed Workflows group shows no count when nothing waits', async () => {
  const page = await open({ p1: NOT_COUNTED });
  await collapse(page);
  assert.equal(shown(page.$(GROUP)), null);
});

// ---- the Definitions tab -------------------------------------------------------------------------

test('#794 the Definitions tab shows the count', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha'), waiting('flow-beta')] });
  assert.equal(shown(page.$(TAB)), '2');
});

test('#794 the Definitions tab\'s count has the same title', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha'), waiting('flow-beta')] });
  const title = titleOf(page, TAB);
  assert.match(title, /\b2\b/);
  assert.equal(title.includes('flow-alpha'), true, title);
  assert.equal(title.includes('flow-beta'), true, title);
});

test('#794 the Definitions tab shows no count when nothing waits', async () => {
  const page = await definitions({ p1: NOT_COUNTED });
  assert.equal(shown(page.$(TAB)), null);
});

// ---- the count stays current ---------------------------------------------------------------------

test('#794 a local merge (worktree.merged) updates the count without a reload', async () => {
  const table = { p1: [] };
  const page = await open(table);
  assert.equal(shown(page.$(SIDEBAR)), null, 'nothing waits yet');
  table.p1 = [waiting('flow-alpha')];
  fireEvent(page, { seq: 1, run_id: 'r1', ts: '2026-11-05T10:00:00.000Z', type: 'worktree.merged', branch: 'multiagent/run-1', base: 'main', commit: HEAD });
  await until(() => shown(page.$(SIDEBAR)) === '1');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

test('#794 the window taking the focus updates the count (a pull made outside the app)', async () => {
  const table = { p1: [] };
  const page = await open(table);
  assert.equal(shown(page.$(SIDEBAR)), null, 'nothing waits yet');
  table.p1 = [waiting('flow-alpha')];
  focusWindow(page);
  await settle(30);
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

const backlog = async (page) => { page.run("showView('backlog')"); await settle(30); };

test('#794 the Backlog\'s Sync updates the count', async () => {
  const table = { p1: [] };
  let afterPull = null;
  const data = { issues: [] };
  const page = await open(table, {
    getBacklog: async () => data,
    syncBacklog: async () => { if (afterPull) table.p1 = afterPull; return data; },
  });
  await backlog(page);
  const before = page.callsTo('syncBacklog').length;
  afterPull = [waiting('flow-alpha')];
  page.$('#btn-bl-sync').click();
  await settle(30);
  assert.equal(page.callsTo('syncBacklog').length, before + 1, 'the button synced');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

test('#794 the Backlog\'s Update and push updates the count', async () => {
  const table = { p1: [] };
  const data = { issues: [], local: { ahead: 1, behind: 1, base: 'main', commits: [], issues: [] } };
  const page = await open(table, {
    getBacklog: async () => data,
    syncBacklog: async () => data,
    updateAndPushLocal: async () => {
      table.p1 = [waiting('flow-alpha')];
      return { pushed: true, local: { ahead: 0, behind: 0, base: 'main', commits: [], issues: [] } };
    },
  });
  await backlog(page);
  page.$('#bl-alerts [data-push]').click();
  await settle(10);
  page.$('#btn-push-update').click();
  await settle(30);
  assert.equal(page.callsTo('updateAndPushLocal').length, 1, 'the button pushed');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

test('#794 the Backlog\'s Check again updates the count', async () => {
  const table = { p1: [] };
  const data = {
    issues: [{ number: 7, title: 'A merged issue', column: 'local', labels: [] }],
    local: { ahead: 0, behind: 0, base: 'main', commits: [], issues: [], error: 'origin not reached' },
  };
  const page = await open(table, {
    getBacklog: async () => data,
    syncBacklog: async () => data,
    checkLocal: async () => { table.p1 = [waiting('flow-alpha')]; return {}; },
  });
  await backlog(page);
  page.$('#bl-alerts [data-check]').click();
  await settle(30);
  assert.equal(page.callsTo('checkLocal').length, 1, 'the button checked');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

// The window's focus reads at most once per 5 s. Date.now is the page's clock (a vm has its own Date).
const repositoryReads = (page) => page.callsTo('listWorkflows').filter(([opts]) => opts?.repositoryOnly).length;
const stopClock = (page) => page.run('var testNow = 1800000000000; Date.now = () => testNow;');
const advanceClock = (page, ms) => page.run(`testNow += ${ms};`);
const focusAndSettle = async (page) => { focusWindow(page); await settle(30); };

test('#794 two focuses in a row read the workflows once', async () => {
  const page = await open({ p1: [] });
  stopClock(page);
  const before = repositoryReads(page);
  await focusAndSettle(page);
  advanceClock(page, 4999);
  await focusAndSettle(page);
  assert.equal(repositoryReads(page), before + 1);
});

test('#794 a focus after the 5 s gap reads again and updates the count', async () => {
  const table = { p1: [] };
  const page = await open(table);
  stopClock(page);
  await focusAndSettle(page);
  table.p1 = [waiting('flow-alpha')];
  advanceClock(page, 1000);
  await focusAndSettle(page);
  assert.equal(shown(page.$(SIDEBAR)), null, 'still inside the gap');
  advanceClock(page, 4000);
  await focusAndSettle(page);
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

// ---- a project change that does not go through the header ----------------------------------------

// the engine's project list is mutable too; removeProject takes the project out of it
const withProjects = (list) => {
  const projects = { list };
  return {
    projects,
    api: {
      listProjects: async () => projects.list,
      removeProject: async ({ id }) => { projects.list = projects.list.filter((p) => p.id !== id); return {}; },
    },
  };
};
async function removeProject(page, id) {
  page.run("showView('projects')");
  await settle(30);
  page.$(`[data-testid="project-card"][data-id="${id}"] [data-act="remove"]`).click();
  await settle(10);
  page.$('#btn-confirm-yes').click();
  await settle(30);
}

test('#794 removing the current project on the Projects screen makes the count follow the next one', async () => {
  const engineProjects = withProjects(PROJECTS);
  const page = await open({ p1: [waiting('flow-alpha')], p2: [waiting('flow-beta'), waiting('flow-gamma')] }, engineProjects.api);
  assert.equal(shown(page.$(SIDEBAR)), '1', 'p1 first');
  await removeProject(page, 'p1');
  assert.equal(page.run('CurrentProject.get()'), 'p2');
  assert.equal(shown(page.$(SIDEBAR)), '2');
  assert.equal(titleOf(page, SIDEBAR).includes('flow-alpha'), false, 'no longer names the removed project\'s');
});

test('#794 removing the only project hides the count', async () => {
  const engineProjects = withProjects([PROJECTS[0]]);
  const page = await open({ p1: [waiting('flow-alpha')] }, engineProjects.api);
  assert.equal(shown(page.$(SIDEBAR)), '1', 'p1 first');
  await removeProject(page, 'p1');
  assert.equal(shown(page.$(SIDEBAR)), null);
});

test('#794 the first project, created through the onboarding, gets its count with no focus and no reload', async () => {
  const engineProjects = withProjects([]);
  const page = await open({ p1: [waiting('flow-alpha')] }, engineProjects.api);
  assert.equal(shown(page.$(SIDEBAR)), null, 'no project yet');
  engineProjects.projects.list = [PROJECTS[0]];
  for (const fn of page.handlers.onOnboardingChanged) fn({ projectId: 'p1', name: 'demo', status: 'running' });
  await settle(30);
  assert.equal(page.run('CurrentProject.get()'), 'p1');
  assert.equal(shown(page.$(SIDEBAR)), '1');
});

// ---- the Definitions tab's top block -------------------------------------------------------------

test('#794 the waiting workflows come first: the block leads the sections and the workspace cards', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha'), accepted('kept-flow')] });
  const order = page.document
    .querySelectorAll('#workflows-list [data-testid="workflows-awaiting-acceptance"], #workflows-list [data-testid="workflow-category"], #workflows-list [data-testid="workflow-card"]')
    .map((el) => el.getAttribute('data-testid'));
  assert.equal(order[0], 'workflows-awaiting-acceptance');
  assert.equal(order.filter((id) => id === 'workflows-awaiting-acceptance').length, 1, 'one block');
});

test('#794 every waiting workflow is in the block, highlighted', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha'), waiting('flow-beta', { category: 'team' })] });
  for (const name of ['flow-alpha', 'flow-beta']) {
    const card = waitingCard(page, name);
    assert.equal(card !== null, true, name);
    assert.equal(card.classList.contains('awaiting-acceptance'), true, `${name} highlighted`);
  }
});

test('#794 a waiting card appears once on the page, not also in its category section', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha')] });
  assert.equal(waitingCard(page, 'flow-alpha') !== null, true, 'in the block');
  assert.equal(allCards(page, 'flow-alpha').length, 1);
  assert.equal(sectionCard(page, 'solo', 'flow-alpha') === null, true, 'not in its section');
});

test('#794 an accepted workflow stays in its category section, without the highlight', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha'), accepted('kept-flow')] });
  const card = sectionCard(page, 'team', 'kept-flow');
  assert.equal(card !== null, true, 'in its section');
  assert.equal(card.classList.contains('awaiting-acceptance'), false);
  assert.equal(waitingCard(page, 'kept-flow') === null, true, 'not in the block');
});

test('#794 with nothing waiting there is no block', async () => {
  const page = await definitions({ p1: NOT_COUNTED });
  assert.equal(page.$(BLOCK) === null, true);
});

test('#794 the reason line says why and shows the commit that changed the file, not HEAD', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha')] });
  const card = waitingCard(page, 'flow-alpha');
  assert.equal(card !== null, true, 'waiting card');
  const reason = card.querySelector('[data-testid="workflow-acceptance-reason"]');
  assert.equal(reason !== null, true, 'reason line');
  const text = norm(textOf(reason));
  assert.match(text, /changed/i);
  assert.equal(text.includes('c0ffee1'), true, text);
  assert.equal(text.includes('abc1234'), false, text);
});

test('#794 a workflow never accepted has the reason line and no diff', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha', { acceptedCommit: null, diff: '' })] });
  const card = waitingCard(page, 'flow-alpha');
  assert.equal(card !== null, true, 'waiting card');
  const reason = card.querySelector('[data-testid="workflow-acceptance-reason"]');
  assert.equal(reason !== null, true, 'reason line');
  assert.match(norm(textOf(reason)), /[a-z]{3,}/i);
  assert.equal(card.querySelector('details.wf-diff') === null, true, 'no diff');
});

test('#794 the diff since the last accepted commit stays on a waiting card', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha', { diff: '-  prompt: old work\n+  prompt: new work' })] });
  const card = waitingCard(page, 'flow-alpha');
  assert.equal(card !== null, true, 'waiting card');
  const diff = card.querySelector('details.wf-diff');
  assert.equal(diff !== null, true, 'the diff');
  const text = norm(textOf(diff));
  assert.equal(text.includes('+ prompt: new work'), true, text);
  assert.equal(text.includes('9876543'), true, 'the accepted commit, short');
});

test('#794 an unreadable repository workflow not accepted is counted and in the block: menu and screen agree', async () => {
  const file = 'workflows/broken-flow.yaml';
  const page = await definitions({ p1: [waiting('broken-flow', { name: file, file, error: 'bad yaml', steps: [] })] });
  assert.equal(shown(page.$(SIDEBAR)), '1');
  assert.equal(titleOf(page, SIDEBAR).includes(file), true, 'the title names it');
  const card = waitingCard(page, file);
  assert.equal(card !== null, true, 'in the block');
  assert.equal(card.classList.contains('awaiting-acceptance'), true, 'highlighted');
  assert.equal(card.querySelector('[data-testid="workflow-accept"]') !== null, true, 'Accept is offered');
});

test('#794 a waiting card\'s badge is orange and says it in words', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha')] });
  const card = waitingCard(page, 'flow-alpha');
  assert.equal(card !== null, true, 'waiting card');
  const badge = card.querySelector('[data-testid="workflow-acceptance"]');
  assert.equal(badge !== null, true, 'the badge');
  assert.equal(badge.classList.contains('orange'), true, 'orange');
  assert.match(norm(textOf(badge)), /not accepted/i);
});

test('#794 a waiting card\'s Accept button is orange', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha')] });
  const card = waitingCard(page, 'flow-alpha');
  assert.equal(card !== null, true, 'waiting card');
  const button = card.querySelector('[data-testid="workflow-accept"]');
  assert.equal(button !== null, true, 'Accept');
  assert.equal(button.classList.contains('orange'), true, 'orange');
});

// ---- accepting -----------------------------------------------------------------------------------

test('#794 Accept records the project, the file and HEAD, not the commit that changed the file', async () => {
  const table = { p1: [waiting('flow-alpha')] };
  const sent = [];
  const page = await definitions(table, { acceptWorkflow: async (arg) => { sent.push(JSON.stringify(arg)); return acceptIn(table).acceptWorkflow(arg); } });
  await accept(page, 'flow-alpha');
  assert.equal(sent.length, 1);
  assert.equal(sent[0], `{"projectId":"p1","file":"workflows/flow-alpha.yaml","commit":"${HEAD}"}`);
});

test('#794 accepting takes the card out of the block and off the highlight; the last one takes the block away', async () => {
  const table = { p1: [waiting('flow-alpha'), waiting('flow-beta')] };
  const page = await definitions(table, acceptIn(table));
  assert.equal(waitingCard(page, 'flow-alpha') !== null, true, 'waiting first');
  await accept(page, 'flow-alpha');
  assert.equal(waitingCard(page, 'flow-alpha') === null, true, 'out of the block');
  const card = sectionCard(page, 'solo', 'flow-alpha');
  assert.equal(card !== null, true, 'back in its section');
  assert.equal(card.classList.contains('awaiting-acceptance'), false, 'no highlight');
  assert.equal(waitingCard(page, 'flow-beta') !== null, true, 'the other one still waits');
  await accept(page, 'flow-beta');
  assert.equal(page.$(BLOCK) === null, true, 'no block left');
});

test('#794 accepting lowers the sidebar\'s count, then hides it, without a reload', async () => {
  const table = { p1: [waiting('flow-alpha'), waiting('flow-beta')] };
  const page = await definitions(table, acceptIn(table));
  assert.equal(shown(page.$(SIDEBAR)), '2');
  await accept(page, 'flow-alpha');
  assert.equal(shown(page.$(SIDEBAR)), '1');
  await accept(page, 'flow-beta');
  assert.equal(shown(page.$(SIDEBAR)), null);
});

test('#794 accepting lowers the Definitions tab\'s count, then hides it, without a reload', async () => {
  const table = { p1: [waiting('flow-alpha'), waiting('flow-beta')] };
  const page = await definitions(table, acceptIn(table));
  assert.equal(shown(page.$(TAB)), '2');
  await accept(page, 'flow-alpha');
  assert.equal(shown(page.$(TAB)), '1');
  await accept(page, 'flow-beta');
  assert.equal(shown(page.$(TAB)), null);
});

test('#794 opening the screen and refreshing the count accepts nothing', async () => {
  const page = await definitions({ p1: [waiting('flow-alpha')] });
  focusWindow(page);
  await settle(30);
  assert.equal(page.callsTo('acceptWorkflow').length, 0);
});

// ---- the orange ----------------------------------------------------------------------------------

test('#794 the highlighted card, the orange badge and the orange button use the theme\'s orange', () => {
  const css = ['../../../packages/ui-kit/style.css', '../views/workflows/workflows.css']
    .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  assert.equal(/\.awaiting-acceptance[^{}]*\{[^{}]*var\(--orange\)/.test(css), true, 'the card');
  assert.equal(/\.badge\.orange[^{}]*\{[^{}]*var\(--orange\)/.test(css), true, 'the badge');
  assert.equal(/\.btn\.orange[^{}]*\{[^{}]*var\(--orange\)/.test(css), true, 'the button');
});
