// src/renderer/views/<view>/: one folder per screen, registering itself with registerView instead of
// index.html listing its markup and nav entry (#78 moved Settings, Usage and Supervisor; #153 moved
// dashboard, sessions, projects, project, backlog, artifacts, workflows, agents, skills and
// analytics; #154 moved run, runchat, duo and arena). A generic check (any view folder registers
// under its own folder name and is loaded by index.html) plus a check that the move left no
// duplicate markup behind in index.html, so this stays a pure move.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');
const indexHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const viewIds = fs.readdirSync(path.join(rendererDir, 'views'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name);

test('views/: all 17 screens have moved into their own folders', () => {
  assert.deepEqual(viewIds.sort(), [
    'agents', 'analytics', 'arena', 'artifacts', 'backlog', 'dashboard', 'duo', 'project',
    'projects', 'run', 'runchat', 'sessions', 'settings', 'skills', 'supervisor', 'usage', 'workflows',
  ]);
});

for (const id of viewIds) {
  test(`views/${id}/${id}.js: registers itself with registerView under id "${id}"`, () => {
    const file = path.join(rendererDir, 'views', id, `${id}.js`);
    assert.ok(fs.existsSync(file), `${file} is missing`);
    const src = fs.readFileSync(file, 'utf8');
    // the call's own indentation, whatever it is (top-level, or one level into an IIFE like
    // views/supervisor/supervisor.js), so its closing "});" is told apart from a nested one
    const call = /^([ \t]*)registerView\(\{[\s\S]*?\n\1\}\);/m.exec(src);
    assert.ok(call, `no registerView({ ... }) call in ${file}`);
    assert.match(call[0], new RegExp(`id:\\s*'${id}'`), `registerView's id does not match the folder name "${id}"`);
  });

  test(`index.html: loads views/${id}/${id}.js, after view-registry.js and before it is used`, () => {
    assert.match(indexHtml, new RegExp(`<script src="views/${id}/${id}\\.js"></script>`));
    const registryAt = indexHtml.indexOf('<script src="view-registry.js"></script>');
    const viewAt = indexHtml.indexOf(`<script src="views/${id}/${id}.js"></script>`);
    assert.ok(registryAt >= 0 && registryAt < viewAt, 'view-registry.js must load before the view that calls registerView');
  });

  test(`index.html: links views/${id}/${id}.css when the view has one`, () => {
    const hasCss = fs.existsSync(path.join(rendererDir, 'views', id, `${id}.css`));
    if (!hasCss) return;
    assert.match(indexHtml, new RegExp(`<link rel="stylesheet" href="views/${id}/${id}\\.css" />`));
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

test('app.js is the shell only: well under 1,000 lines, its header naming the shared pieces moved into their own file', () => {
  const appSrc = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  const lines = appSrc.split('\n').length;
  assert.ok(lines < 1000, `app.js has grown to ${lines} lines`);
  const header = appSrc.slice(0, appSrc.indexOf('\nconst $ ='));
  for (const shared of ['start-drawer.js', 'gate-panel.js', 'resume-dialog.js', 'supervisor-drawer.js', 'term-dock.js']) {
    assert.match(header, new RegExp(shared.replace('.', '\\.')), `app.js's header does not name ${shared}`);
  }
});
