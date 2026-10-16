// #330 Interface language part 2: every screen translated (written before the code). #329 moved
// Settings and the Setup to the catalog (src/shared/i18n.js, src/shared/i18n/en.json, pt-BR.json);
// #330 moves the rest. These tests guard that:
// (a) every .js file under src/renderer (the whole folder: a new view is in it by itself, the Agents
//     window and the shared renderer modules too) and the src/shared/ modules with screen text show no
//     visible text outside t() (test/untranslated-text.js, the check of #329 part c); index.html's
//     static text carries its data-i18n hook (data-i18n, data-i18n-title, data-i18n-aria-label,
//     data-i18n-placeholder), the product name left out;
// (b) the screen text the page's src/shared/ modules build follows the interface language
//     (I18n.setLanguage, as the page and the service set it): the Roadmap's refusal reasons and pause
//     choices (roadmap-model.js allowedActions, pauseChoices), the Product Owner calibration's steps
//     (po-calibration.js label, cost.label), the platforms' epic help (platforms/github.js,
//     gitlab.js epicHelp); the English text is today's, unchanged;
// (c) fixed text the engine and the service build to be shown follows it too: the memory guard's
//     `process.killed` message (src/engine/run/turns.js watchMemory) and the Oracle's monthly budget
//     refusal (src/oracle.js monthlyBlock); engine errors and logs stay English (not tested here);
// (d) pt-BR.json has every key of en.json (#329 only checks a missing key falls back to English);
// (e) a few screens rendered in Portuguese (the real page, test/renderer-app-harness.js): Home's empty
//     state, the Inbox, the Backlog's kanban show none of the English labels they show today, and no
//     text of theirs is an English catalog text that pt-BR translates (English leaking); in English
//     they still show those labels.
// Anything #330 creates is loaded inside the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { report, sourceFiles, untranslated, untranslatedHtml } = require('./untranslated-text');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const RENDERER = path.join(SRC, 'renderer');
const SHARED = path.join(SRC, 'shared');
const CATALOGS = path.join(SHARED, 'i18n');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// the src/shared/ modules the page loads that build screen text (a folder: every .js in it)
const SHARED_SCREEN = ['roadmap-model.js', 'po-calibration.js', 'platforms/'];
const sharedScreenFiles = () => SHARED_SCREEN.flatMap((p) => (p.endsWith('/') ? sourceFiles(path.join(SHARED, p)) : [path.join(SHARED, p)]));

const I18n = () => require(path.join(SHARED, 'i18n.js'));

// ---- (a) no visible text outside t() ------------------------------------------------------------
test('#330 (a) every .js file under src/renderer shows no visible text outside t()', () => {
  const files = sourceFiles(RENDERER);
  const names = files.map(rel);
  for (const must of ['src/renderer/views/backlog/backlog.js', 'src/renderer/views/dashboard/dashboard.js', 'src/renderer/agents-window.js', 'src/renderer/run-list.js', 'src/renderer/run-badges.js', 'src/renderer/agent-chat.js', 'src/renderer/artifacts-panel.js', 'src/renderer/setup.js']) {
    assert.ok(names.includes(must), `the check scans ${must}`);
  }
  assert.ok(names.some((n) => n.startsWith('src/renderer/views/settings/')), 'the check scans views/settings/');
  const found = files.flatMap((f) => untranslated(fs.readFileSync(f, 'utf8'), rel(f)));
  assert.deepEqual(found, [], report(found));
});

test('#330 (a) the src/shared/ modules with screen text show no visible text outside t() in their markup', () => {
  const files = sharedScreenFiles();
  assert.ok(files.length >= 5, `scanned: ${files.map(rel).join(', ')}`);
  const found = files.flatMap((f) => untranslated(fs.readFileSync(f, 'utf8'), rel(f)));
  assert.deepEqual(found, [], report(found));
});

test('#330 (a) the index.html check itself: a hook translates, a literal without one is caught, the product name is not', () => {
  assert.equal(untranslatedHtml('<button id="x" data-i18n="shell.run">Run</button>').length, 0);
  assert.equal(untranslatedHtml('<button id="x">Run</button>').length, 1);
  assert.equal(untranslatedHtml('<button title="Close" data-i18n-title="common.close">×</button>').length, 0);
  assert.equal(untranslatedHtml('<button title="Close">×</button>').length, 1);
  assert.equal(untranslatedHtml('<input placeholder="Ask about this run" />').length, 1);
  assert.equal(untranslatedHtml('<input placeholder="Ask" data-i18n-placeholder="sup.ask" />').length, 0);
  assert.equal(untranslatedHtml('<div class="brand">Multiagent <span>Orchestrator</span></div>').length, 0);
  assert.equal(untranslatedHtml('<title>Multiagent Orchestrator</title>').length, 0);
  assert.equal(untranslatedHtml('<!-- <b>Start workflow</b> -->').length, 0);
  assert.equal(untranslatedHtml('<label for="p">Project <span class="req">*</span></label>').length, 1);
  assert.equal(untranslatedHtml('<b>Claude Code</b> <!-- i18n-ignore -->').length, 0);
});

test('#330 (a) src/renderer/index.html: every static text and label carries its data-i18n hook', () => {
  const htmls = fs.readdirSync(RENDERER).filter((f) => f.endsWith('.html'));
  assert.ok(htmls.includes('index.html'), htmls.join(', '));
  const found = htmls.flatMap((f) => untranslatedHtml(fs.readFileSync(path.join(RENDERER, f), 'utf8'), `src/renderer/${f}`));
  assert.deepEqual(found, [], report(found, 'static text without its data-i18n hook (data-i18n, data-i18n-title, data-i18n-aria-label, data-i18n-placeholder)'));
});

// ---- (b) the src/shared/ modules' screen text follows the interface language -----------------------
/** The value in English, then in pt-BR (the current language set as the page and the service do). */
function inBoth(fn) {
  const i18n = I18n();
  i18n.setLanguage('en');
  const en = fn();
  i18n.setLanguage('pt-BR');
  const pt = fn();
  i18n.setLanguage('en');
  return { en, pt };
}
const restoreEnglish = () => I18n().setLanguage('en');

test('#330 (b) roadmap-model.js: the refusal reasons and the pause choices follow the interface language', (t) => {
  t.after(restoreEnglish);
  const RoadmapModel = require(path.join(SHARED, 'roadmap-model.js'));
  const running = { state: 'running', stages: [{ id: 's1', name: 'One', items: [{ id: 'i1', status: 'planned', issues: [] }] }] };
  const texts = () => {
    const a = RoadmapModel.allowedActions(running, null, null);
    const choices = RoadmapModel.pauseChoices(running);
    return [a.start.reason, a.resume.reason, a.edit.reason, choices[1].label, choices[1].hint];
  };
  const { en, pt } = inBoth(texts);
  assert.deepEqual(en, ['The roadmap is already running.', 'The roadmap is not paused.', 'No item given.', 'Pause now', 'Nothing new starts; runs in progress go on']);
  pt.forEach((s, i) => assert.notEqual(s, en[i], `"${en[i]}" is translated in pt-BR`));
  assert.ok(pt.every((s) => typeof s === 'string' && s.trim()), JSON.stringify(pt));
});

test('#330 (b) po-calibration.js: the calibration and cost steps\' names follow the interface language', (t) => {
  t.after(restoreEnglish);
  const PoCalibration = require(path.join(SHARED, 'po-calibration.js'));
  const texts = () => [PoCalibration.label(1), PoCalibration.label(5), PoCalibration.cost.label(1), PoCalibration.cost.label(5)];
  const { en, pt } = inBoth(texts);
  assert.deepEqual(en, ['Speed (1/5)', 'Quality (5/5)', 'Economy (1/5)', 'Generous (5/5)']);
  pt.forEach((s, i) => assert.notEqual(s, en[i], `"${en[i]}" is translated in pt-BR`));
  assert.match(pt[0], /\(1\/5\)$/);
});

test('#330 (b) platforms: the epic help follows the interface language (GitHub and GitLab)', (t) => {
  t.after(restoreEnglish);
  const Platforms = require(path.join(SHARED, 'platforms', 'index.js'));
  const help = (p) => String(typeof p.epicHelp === 'function' ? p.epicHelp() : p.epicHelp);
  const texts = () => [help(Platforms.platformOrDefault('github')), help(Platforms.platformOrDefault('gitlab'))];
  const { en, pt } = inBoth(texts);
  assert.deepEqual(en, ['GitHub: an issue labelled epic, whose sub-issues are its members', 'GitLab: a group epic, or an issue labelled epic whose members carry epic::<name>']);
  pt.forEach((s, i) => assert.notEqual(s, en[i], `"${en[i]}" is translated in pt-BR`));
  assert.match(pt[0], /GitHub/);
  assert.match(pt[1], /epic::/, 'the label stays as it is');
  // what never changes: the short terms and a reference
  assert.equal(Platforms.requestRef('github', 12), 'PR #12');
  assert.equal(Platforms.requestRef('gitlab', 12), 'MR !12');
});

// ---- (c) engine and service text shown on screen ------------------------------------------------
test('#330 (c) the memory guard\'s process.killed message follows the interface language', (t) => {
  t.after(restoreEnglish);
  const { methods, gib } = require(path.join(SRC, 'engine', 'run', 'turns.js'));
  const kill = { pid: 42, commandLine: 'node build.js', bytes: 5 * 1024 ** 3, limitBytes: 4 * 1024 ** 3 };
  const message = () => {
    const events = [];
    const run = {
      memoryGuard: { watch: (opts) => { opts.onKill(kill); return { stop() {} }; } },
      memoryStops: new Map(),
      memoryNotes: new Map(),
      emitEvent: (type, data) => events.push({ type, message: data.message }),
    };
    methods.watchMemory.call(run, { stepId: 'build', agentName: null });
    const ev = events.find((e) => e.type === 'process.killed');
    assert.ok(ev, `a process.killed event: ${JSON.stringify(events)}`);
    return ev.message;
  };
  const { en, pt } = inBoth(message);
  assert.equal(en, `The memory guard stopped \`node build.js\` (pid 42) at ${gib(kill.bytes)} GB: over the limit of ${gib(kill.limitBytes)} GB per process.`);
  assert.notEqual(pt, en);
  assert.ok(pt.includes('node build.js') && pt.includes('42'), pt);
});

test('#330 (c) the Oracle\'s monthly budget refusal follows the interface language', (t) => {
  t.after(restoreEnglish);
  const oracle = require(path.join(SRC, 'oracle.js'));
  const budget = { claude: { name: 'Claude Code', blockOnLimit: true, limitUsd: 10, usedUsd: 10 } };
  const { en, pt } = inBoth(() => oracle.monthlyBlock(budget));
  assert.equal(en, 'Claude Code already reached its monthly budget. Raise it in Usage to ask the Oracle.');
  assert.notEqual(pt, en);
  assert.match(pt, /Claude Code/);
});

// ---- (d) the pt-BR catalog is complete ----------------------------------------------------------
test('#330 (d) pt-BR.json has every key of en.json', () => {
  const en = readJson(path.join(CATALOGS, 'en.json'));
  const pt = readJson(path.join(CATALOGS, 'pt-BR.json'));
  const missing = Object.keys(en).filter((k) => !(k in pt));
  assert.deepEqual(missing, [], `keys missing from pt-BR.json:\n${missing.slice(0, 40).join('\n')}`);
});

// ---- (e) screens rendered in Portuguese ---------------------------------------------------------
const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&[#\w]+;/g, ' ');
const WORDS = /[A-Za-zÀ-ÿ]{2,}/;

/** Every text a markup string shows: its text nodes and its title / aria-label / placeholder / alt values. */
function shownTexts(html) {
  const out = [];
  const src = String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  for (const part of src.split(/<[^>]*>/)) {
    const s = decode(part).replace(/\s+/g, ' ').trim();
    if (WORDS.test(s)) out.push(s);
  }
  for (const m of src.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) {
    const s = decode(m[1]).replace(/\s+/g, ' ').trim();
    if (WORDS.test(s)) out.push(s);
  }
  return out;
}

/** The English texts pt-BR translates to something else (a text of any pt-BR key excluded). */
function englishOnlyTexts() {
  const en = readJson(path.join(CATALOGS, 'en.json'));
  const pt = readJson(path.join(CATALOGS, 'pt-BR.json'));
  const forms = (v) => (typeof v === 'string' ? [v] : Object.values(v || {}));
  const ptTexts = new Set(Object.values(pt).flatMap(forms));
  const out = new Set();
  for (const [k, v] of Object.entries(en)) {
    for (const s of forms(v)) {
      if (/\{\w+\}/.test(s) || !WORDS.test(s) || ptTexts.has(s)) continue;
      if (k in pt && JSON.stringify(pt[k]) !== JSON.stringify(v)) out.add(s);
    }
  }
  return out;
}

/** Opens one view of the real page in `lang`; returns every text the page shows (strings only). */
async function render(lang, view, { api = {}, storage = {}, after } = {}) {
  const { loadApp } = require('./renderer-app-harness');
  const app = loadApp({
    storage: { interfaceLanguage: lang, ...storage },
    api: { getSettings: async () => ({ lastProject: 'p1', language: { interface: lang } }), ...api },
  });
  await app.boot();
  app.run(`showView(${JSON.stringify(view)})`);
  await app.settle(30);
  if (after) await after(app);
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
    if (el.textContent && !el.innerHTML) parts.push(String(el.textContent).replace(/</g, ' '));
  }
  return shownTexts(parts.join('\n'));
}

/** Asserts the pt-BR render has no English label (the given ones, any English-only catalog text) and the English one still has them. */
async function checkPortuguese(view, labels, options) {
  const en = await render('en', view, options);
  for (const label of labels) assert.ok(en.includes(label), `in English, ${view} shows "${label}"`);
  const pt = await render('pt-BR', view, options);
  const stillEnglish = labels.filter((label) => pt.includes(label));
  assert.deepEqual(stillEnglish, [], `${view} in pt-BR still shows these English labels`);
  const english = englishOnlyTexts();
  const leaking = [...new Set(pt.filter((s) => english.has(s)))];
  assert.deepEqual(leaking, [], `${view} in pt-BR shows English texts the catalog translates`);
}

const PROJECTS = [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/work/one' }];

test('#330 (e) Home\'s empty state in Portuguese: no English label left, English unchanged', async () => {
  await checkPortuguese('dashboard', ['Create a project', 'Capture an idea', 'Run a workflow', 'Overview'], {
    storage: {},
    api: {
      listProjects: async () => [],
      listWorkflows: async () => [],
      listActiveRuns: async () => [],
      listUnpushed: async () => [],
      listDiscoveryCards: async () => [],
      getBacklog: async () => null,
      listReleases: async () => null,
      nightWatchMorning: async () => null,
    },
  });
});

test('#330 (e) the Inbox in Portuguese: the capture form and a card\'s actions have no English label left', async () => {
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const cards = [{ id: '20261004-aaaa', title: 'Older idea', type: 'idea', column: 'inbox', author: 'alice', created: iso(300), updated: iso(300), attachments: [] }];
  await checkPortuguese('inbox', ['Capture', 'A title for the idea', 'Quick capture', 'Accept', 'Move to Discovery › Triage'], {
    storage: { 'multiagent.currentProject': 'p1' },
    api: { listProjects: async () => PROJECTS, listDiscoveryCards: async () => cards },
  });
});

test('#330 (e) the Backlog kanban in Portuguese: its columns have no English label left', async () => {
  const issue = (number, column) => ({
    number, title: `Issue ${number}`, state: 'open', column, labels: [], assignees: [], author: 'eduardo', body: '',
    url: `https://github.com/o/r/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
    tasks: { total: 0, done: 0 }, runs: [], pullRequests: [],
  });
  const data = { platform: 'github', syncedAt: '2026-10-01T00:00:00Z', issues: [issue(1, 'todo'), issue(2, 'in_progress'), issue(3, 'local')], epics: [] };
  await checkPortuguese('backlog', ['To do', 'In progress', 'Merged locally'], {
    storage: { 'multiagent.backlogProject': 'p1', 'multiagent.currentProject': 'p1' },
    api: { listProjects: async () => PROJECTS, getBacklog: async () => data, syncBacklog: async () => data },
    after: (app) => app.click('#bl-mode', { dataset: { mode: 'kanban' } }),
  });
});
