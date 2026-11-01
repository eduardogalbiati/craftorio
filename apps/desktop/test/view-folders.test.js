// views/<view>/: one folder per screen, registering itself with registerView instead of
// index.html listing its markup and nav entry (#78 moved Settings, Usage and Supervisor; #153 moved
// dashboard, sessions, projects, project, backlog, artifacts, workflows, agents, skills and
// analytics; #154 moved run, runchat, duo and arena; #171 added oracle; #256 added inbox; #257 added discovery;
// #647 added docs).
// Phase 3 of the reorganisation study (#579) spreads the folders over the UI kit (the shell's
// screens), the fronts and the app's own page folder: scripts/source-tree.js (pageDirs, pageFile)
// says where each lives, and the desktop page (apps/desktop/renderer/index.html) still loads every
// one. A generic check (any view folder registers under its own folder name and is loaded by
// index.html) plus a check that the move left no duplicate markup behind in index.html, so this
// stays a pure move.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const { pageDirs, pageFile, viewsOf } = require('../../../scripts/source-tree');

const ROOT = path.join(__dirname, '..', '..', '..');
const indexHtml = fs.readFileSync(pageFileOf('index.html'), 'utf8');
const viewIds = pageDirs(ROOT).flatMap((dir) => viewsOf(ROOT, dir));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('views/: all 23 screens have moved into their own folders (#260 added releases, #257 discovery, #647 docs)', () => {
  assert.deepEqual([...viewIds].sort(), [
    'agents', 'analytics', 'arena', 'artifacts', 'backlog', 'dashboard', 'discovery', 'docs', 'duo', 'inbox', 'nightwatch', 'oracle',
    'project', 'projects', 'releases', 'run', 'runchat', 'sessions', 'settings', 'skills', 'supervisor', 'usage', 'workflows',
  ]);
});

for (const id of viewIds) {
  test(`views/${id}/${id}.js: registers itself with registerView under id "${id}"`, () => {
    const file = pageFile(ROOT, `views/${id}/${id}.js`);
    assert.ok(file && fs.existsSync(file), `views/${id}/${id}.js is missing`);
    const src = fs.readFileSync(file, 'utf8');
    // the call's own indentation, whatever it is (top-level, or one level into an IIFE like
    // views/supervisor/supervisor.js), so its closing "});" is told apart from a nested one
    const call = /^([ \t]*)registerView\(\{[\s\S]*?\n\1\}\);/m.exec(src);
    assert.ok(call, `no registerView({ ... }) call in ${file}`);
    assert.match(call[0], new RegExp(`id:\\s*'${id}'`), `registerView's id does not match the folder name "${id}"`);
  });

  test(`index.html: loads views/${id}/${id}.js, after view-registry.js and before it is used`, () => {
    const viewTag = new RegExp(`<script src="[^"]*views/${esc(id)}/${esc(id)}\\.js"></script>`);
    assert.match(indexHtml, viewTag);
    const registryAt = indexHtml.search(/<script src="[^"]*view-registry\.js"><\/script>/);
    const viewAt = indexHtml.search(viewTag);
    assert.ok(registryAt >= 0 && registryAt < viewAt, 'view-registry.js must load before the view that calls registerView');
  });

  test(`index.html: links views/${id}/${id}.css when the view has one`, () => {
    const hasCss = !!pageFile(ROOT, `views/${id}/${id}.css`);
    if (!hasCss) return;
    assert.match(indexHtml, new RegExp(`<link rel="stylesheet" href="[^"]*views/${esc(id)}/${esc(id)}\\.css" />`));
  });
}

test('index.html: no longer holds the Settings screen inline (moved into views/settings/settings.js)', () => {
  assert.doesNotMatch(indexHtml, /id="view-settings"/);
  assert.doesNotMatch(indexHtml, /class="settings-tab/);
  assert.doesNotMatch(indexHtml, /id="set-ws-path"/);
});

test('index.html: no longer holds the Usage screen or its budget dialog inline (moved into views/usage/usage.js)', () => {
  assert.doesNotMatch(indexHtml, /id="view-usage"/);
  assert.doesNotMatch(indexHtml, /id="budget-modal"/);
  assert.doesNotMatch(indexHtml, /id="usage-cards"/);
});

test('index.html: the Usage top-bar popover (app-wide, not part of the view) is still there', () => {
  // the popover lives in the shell (app.js/index.html), only the Usage screen itself moved
  assert.match(indexHtml, /id="usage-pop-month"/);
});

test('index.html: no longer holds the #153 screens inline (moved into their own views/<view>/ folders)', () => {
  for (const id of ['agents', 'analytics', 'artifacts', 'backlog', 'dashboard', 'project', 'projects', 'sessions', 'skills', 'workflows']) {
    assert.doesNotMatch(indexHtml, new RegExp(`id="view-${id}"`), `index.html still has id="view-${id}"`);
  }
});

test('index.html: no longer holds the #154 run screens inline (moved into their own views/<view>/ folders)', () => {
  for (const id of ['run', 'runchat', 'duo', 'arena']) {
    assert.doesNotMatch(indexHtml, new RegExp(`id="view-${id}"`), `index.html still has id="view-${id}"`);
  }
});

test('index.html: no <section class="view"> markup is left; every screen registers its own', () => {
  assert.doesNotMatch(indexHtml, /<section[^>]*class="view/);
});

// app.js's 1,000-line cap is the rule of every source file (#334, file-size-ratchet-334.test.js).
test('app.js is the shell only: its header naming the shared pieces moved into their own file', () => {
  const appSrc = fs.readFileSync(pageFile(ROOT, 'app.js'), 'utf8');
  const header = appSrc.slice(0, appSrc.indexOf('\nconst $ ='));
  for (const shared of ['start-drawer.js', 'gate-panel.js', 'resume-dialog.js', 'supervisor-drawer.js', 'term-dock.js']) {
    assert.match(header, new RegExp(shared.replace('.', '\\.')), `app.js's header does not name ${shared}`);
  }
});
