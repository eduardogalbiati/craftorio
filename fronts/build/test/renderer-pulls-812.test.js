// #812 the PRs / MRs screen in the UI (fronts/build/views/pulls/pulls.js): every open pull request of the project by
// what it needs (Need you, Waiting, Others), each one the run's PR card (packages/shared/pr-card.js) with a link to its
// run when it has one, a stack (#807) in merge order with Merge on its bottom PR only, a project that cannot be read
// saying so, and the empty states. The page is the real one (@craftorio/ui-kit/test/renderer-app-harness loads
// index.html's scripts in a vm sandbox; nothing is parsed, the tests read the markup strings the views produce).
// Acceptance tests, written before the code: the view is reached inside each test.
//
// The interface these tests assume (the developer implements it as named):
//   views/pulls/pulls.js, loaded by index.html, registerView({ id: 'pulls', nav: { group: 'build', ... } }) and
//   window.PullsView = {
//     menuLabel(platformId) → 'PRs' (github) | 'MRs' (gitlab)   (i18n pulls.menu_prs / pulls.menu_mrs)
//     needYouCount(answer) → the number of Need-you entries in the answer (the menu's count)
//   }
//   On open (showView('pulls')) it calls window.api.listPullRequests(<the header's project id>) → the answer
//     { projects: [{ projectId, name, platform, error, reason: null | 'no_remote' | 'no_cli', groups: { needYou, waiting, others } }] }
//     (engine: run-pr.js listPulls, channel pulls:list), and reads again every few minutes: a timer of 1 to 15 minutes.
//   data-testids: pulls-group (data-group="need-you" | "waiting" | "others", in that order, titled Need you / Waiting /
//     Others), pulls-entry (data-number="<n>") holding the PR card, pulls-run-link (data-run="<runId>") on an entry of a
//     run, the card's buttons pr-merge / pr-merge-admin / pr-close (pr-card.js TESTIDS) and never pr-ask-fix without a
//     run, pulls-project-error (a project that cannot be read, with its name and the error), pulls-empty
//     (data-reason="none" | "no_remote" | "no_cli").
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, text } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PROJECTS = [{ id: 'shop', name: 'Shop', repo: 'https://github.com/acme/shop' }, { id: 'site', name: 'Site', repo: 'https://gitlab.com/grp/site' }];
const OPTS = (merge) => ({ merge, bypass: false, close: true, blockers: merge ? [] : ['ci_running'], ignores: [], askFix: false });
const entry = (number, extra = {}) => ({
  number, title: `PR title ${number}`, url: `https://github.com/acme/shop/pull/${number}`, author: 'eduardo', draft: false,
  head: `feat-${number}`, base: 'main', state: 'ready', runId: null, stack: null,
  ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: [] }, conflicts: { status: 'none' }, comments: { unanswered: 0 },
  result: { ready: true, blockers: [] }, mergeOptions: OPTS(true), ...extra,
});
const WAITING = { state: 'pending', ci: { status: 'running', failed: [] }, result: { ready: false, blockers: ['CI running'] }, mergeOptions: OPTS(false) };
const project = (groups, extra = {}) => ({ projectId: 'shop', name: 'Shop', platform: 'github', error: null, reason: null, groups: { needYou: [], waiting: [], others: [], ...groups }, ...extra });

const ANSWER = {
  projects: [project({
    needYou: [
      entry(1, { runId: 'r1' }),
      entry(21, { runId: 'r21', head: 'stage-1', stack: { position: 1, size: 2 } }),
      entry(22, { runId: 'r22', head: 'stage-2', base: 'stage-1', stack: { position: 2, size: 2 }, mergeOptions: OPTS(false) }),
    ],
    waiting: [entry(5, { runId: 'r5', ...WAITING })],
    others: [entry(9, { author: 'app/dependabot' }), entry(10)],
  })],
};

// every markup string the page holds: the views' own markup, what was written into an element, and what was inserted
function pageMarkup(app) {
  const parts = [];
  for (const def of app.defs.values()) parts.push(String(def.markup || ''));
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  return parts.join('\n');
}
// the markup of the screen's list: the latest markup holding a pulls-group, pulls-empty or pulls-project-error
function screen(app) {
  const all = [...app.elements.values(), ...app.created].flatMap((el) => [String(el.innerHTML || ''), ...(el.inserted || []).map(([, h]) => String(h || ''))]);
  return all.filter((h) => /data-testid="pulls-(group|empty|project-error)"/.test(h)).pop() || '';
}
const tagsOf = (html, testid) => [...html.matchAll(/<[a-z][^>]*>/gi)].map((m) => ({ tag: m[0], at: m.index })).filter((x) => x.tag.includes(`data-testid="${testid}"`));
const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
// the groups in order, each with the numbers of its entries
function groups(html) {
  const gs = tagsOf(html, 'pulls-group');
  return gs.map((g, i) => {
    const part = html.slice(g.at, gs[i + 1]?.at ?? html.length);
    return [attr(g.tag, 'data-group'), tagsOf(part, 'pulls-entry').map((e) => Number(attr(e.tag, 'data-number')))];
  });
}
// one entry's markup, up to the next entry or group
function entryHtml(html, number) {
  const es = [...tagsOf(html, 'pulls-entry'), ...tagsOf(html, 'pulls-group')].sort((a, b) => a.at - b.at);
  const i = es.findIndex((e) => e.tag.includes('pulls-entry') && attr(e.tag, 'data-number') === String(number));
  return i < 0 ? '' : html.slice(es[i].at, es[i + 1]?.at ?? html.length);
}
const buttons = (html) => (html.match(/data-testid="(pr-merge|pr-merge-admin|pr-close|pr-ask-fix)"/g) || []).map((s) => s.slice(13, -1));

async function openPulls(answer = ANSWER, { timers } = {}) {
  const app = loadApp({ api: { listProjects: async () => PROJECTS, listPullRequests: async () => answer }, storage: { 'multiagent.currentProject': 'shop' } });
  await app.boot();
  assert.ok(app.defs.has('pulls'), 'a view registered under the id "pulls" (views/pulls/pulls.js, loaded by index.html)');
  if (timers) {
    const { setTimeout: later } = app.sandbox;
    app.sandbox.setInterval = (fn, ms) => { timers.push(Number(ms)); return 0; };
    app.sandbox.setTimeout = (fn, ms, ...a) => { timers.push(Number(ms)); return later(fn, ms, ...a); };
  }
  app.run("showView('pulls')");
  await app.settle(20);
  return app;
}
const pullsView = async () => {
  const app = loadApp({ api: { listProjects: async () => PROJECTS } });
  await app.boot();
  const v = app.run('window.PullsView');
  assert.ok(v, 'window.PullsView');
  return v;
};

// ---- the menu ----------------------------------------------------------------------------------

test('#812 menu: the entry is named PRs on GitHub and MRs on GitLab, in Code & Build', async () => {
  const app = loadApp({ api: { listProjects: async () => PROJECTS } });
  await app.boot();
  const def = app.defs.get('pulls');
  const v = app.run('window.PullsView');
  assert.deepEqual([def?.nav?.group, v?.menuLabel('github'), v?.menuLabel('gitlab')], ['build', 'PRs', 'MRs']);
});

test('#812 menu: its count is the number of pull requests that need the owner', async () => {
  const v = await pullsView();
  assert.deepEqual([v.needYouCount(ANSWER), v.needYouCount({ projects: [project({ waiting: [entry(5, WAITING)] })] })], [3, 0]);
});

// ---- the screen --------------------------------------------------------------------------------

test('#812 the screen reads the header\'s project on open and lists Need you, Waiting and Others in that order', async () => {
  const app = await openPulls();
  const html = screen(app);
  const titled = tagsOf(html, 'pulls-group').map((g, i) => text(html.slice(g.at, g.at + 400)).startsWith(['Need you', 'Waiting', 'Others'][i]));
  assert.deepEqual(
    [app.callsTo('listPullRequests')[0]?.[0], groups(html), titled],
    ['shop', [['need-you', [1, 21, 22]], ['waiting', [5]], ['others', [9, 10]]], [true, true, true]],
  );
});

test('#812 the screen reads again every few minutes, not in a tight loop', async () => {
  const timers = [];
  await openPulls(ANSWER, { timers });
  const minutes = timers.filter((ms) => ms >= 60 * 1000 && ms <= 15 * 60 * 1000);
  assert.equal(minutes.length > 0, true, `a 1 to 15 minute timer, saw ${JSON.stringify(timers)}`);
});

test('#812 an entry of a run is its PR card with a link to the run; a PR with no run has no link and no Ask for a fix', async () => {
  const html = screen(await openPulls());
  const ofRun = entryHtml(html, 1);
  const noRun = entryHtml(html, 10);
  assert.deepEqual(
    [tagsOf(ofRun, 'pulls-run-link').map((l) => attr(l.tag, 'data-run')), ofRun.includes('pr-monitor-line'), tagsOf(noRun, 'pulls-run-link').length, buttons(noRun)],
    [['r1'], true, 0, ['pr-merge', 'pr-close']],
  );
});

test('#812 a stack: its PRs together, bottom first, Merge only on the bottom one', async () => {
  const html = screen(await openPulls());
  assert.deepEqual([buttons(entryHtml(html, 21)).includes('pr-merge'), buttons(entryHtml(html, 22)).includes('pr-merge'), buttons(entryHtml(html, 22)).includes('pr-close')], [true, false, true]);
});

test('#812 a project that cannot be read says so with its error, and the other project is still listed', async () => {
  const answer = {
    projects: [
      project({}, { projectId: 'broken', name: 'Broken', error: 'gh: HTTP 404: Could not resolve to a Repository' }),
      project({ needYou: [entry(1, { runId: 'r1' })] }),
    ],
  };
  const app = await openPulls(answer);
  const html = pageMarkup(app);
  const err = tagsOf(html, 'pulls-project-error')[0];
  const errText = err ? text(html.slice(err.at, err.at + 600)) : '';
  assert.deepEqual([errText.includes('Broken'), errText.includes('Could not resolve'), [...new Set(groups(html).filter(([g]) => g === 'need-you').flatMap(([, n]) => n))]], [true, true, [1]]);
});

test('#812 empty states: no pull request, no remote and no gh / glab each have their own message', async () => {
  const seen = [];
  for (const [reason, groupsOf] of [[null, {}], ['no_remote', {}], ['no_cli', {}]]) {
    const html = screen(await openPulls({ projects: [project(groupsOf, { reason })] }));
    const empty = tagsOf(html, 'pulls-empty')[0];
    seen.push([empty ? attr(empty.tag, 'data-reason') : null, empty ? text(html.slice(empty.at, empty.at + 400)).length > 0 : false]);
  }
  assert.deepEqual(seen, [['none', true], ['no_remote', true], ['no_cli', true]]);
});
