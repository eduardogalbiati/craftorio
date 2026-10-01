// #77: shared docs generated from per-feature fragments instead of hand-edited shared lists.
// #152: src/renderer/index.html's <link>/<script> lists are generated the same way.
// Seams: scripts/docs.js's own exports (renderReadme, missingHeaders, codeMap, main, loadRule,
// rendererAssets, renderIndexHtml).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  codeMap, loadRule, main, missingHeaders, renderIndexHtml, rendererAssets, renderReadme,
} = require('../scripts/docs.js');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('README.md tables are up to date with the generator', () => {
  const readme = read(path.join(root, 'README.md'));
  assert.equal(renderReadme(readme, root), readme);
});

test('every source file has a header comment the code map can build from', () => {
  assert.deepEqual(missingHeaders(root), []);
});

test('the generated code map documents the channel manifest folder', () => {
  assert.match(codeMap(root), /src\/service\/manifest\.js/);
  assert.match(codeMap(root), /src\/service\/channels\//);
});

// A temporary root with just src/renderer/views/: enough for codeMap's own views-folder rows
// (it does not read skills/, docs/screens/ or README.md).
function tmpViewsRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-map-views-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, 'src', 'renderer', 'views', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}

test('the generated code map adds no views/ rows when src/renderer/views/ does not exist', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-map-no-views-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // the "Adding things" section mentions `src/renderer/views/<view>/` by itself: only a generated
  // row (naming a real folder) counts as evidence of a screen folder.
  assert.doesNotMatch(codeMap(tmp), /\| `src\/renderer\/views\/[^`]+\/` \|/);
});

test('the generated code map adds one row per view folder, listing only its .js/.css files, sorted', (t) => {
  const tmp = tmpViewsRoot(t, {
    'foo/b.js': '// b\n',
    'foo/a.js': '// a\n',
    'foo/a.css': '/* a */\n',
    'foo/readme.md': 'not js or css\n',
  });
  const map = codeMap(tmp);
  assert.match(map, /\| `src\/renderer\/views\/foo\/` \| The foo screen's folder \(registered with `registerView`\): `a\.css`, `a\.js`, `b\.js`\. \|/);
  assert.doesNotMatch(map, /readme\.md/);
});

// A temporary copy of only what the generator reads (skills/, docs/screens/, README.md): editing
// one skill's summary there must not touch the real repository's files.
function tmpDocsRoot(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-root-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'skills'), path.join(tmp, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs'));
  fs.cpSync(path.join(root, 'docs', 'screens'), path.join(tmp, 'docs', 'screens'), { recursive: true });
  fs.copyFileSync(path.join(root, 'README.md'), path.join(tmp, 'README.md'));
  return tmp;
}

test('a skill\'s frontmatter change is picked up by the README table, and --check reports the README as stale', (t) => {
  const tmp = tmpDocsRoot(t);
  const skillFile = path.join(tmp, 'skills', 'code-review', 'SKILL.md');
  fs.writeFileSync(skillFile, read(skillFile).replace(/^summary: .*$/m, 'summary: "Changed for this test"'));

  const readme = read(path.join(tmp, 'README.md'));
  const rendered = renderReadme(readme, tmp);
  assert.notEqual(rendered, readme);
  assert.match(rendered, /Changed for this test/);

  assert.equal(main(['--check'], tmp), 1);
});

test('--check passes on an up-to-date copy', (t) => {
  const tmp = tmpDocsRoot(t);
  // missingHeaders(tmp) would fail on the copy (no src/scripts/ there to check), so --check only
  // reports the README here: confirm it is silent when nothing changed.
  assert.equal(main(['--check'], tmp), 0);
});

// #152: src/renderer/index.html's <link>/<script> lists.

test('src/renderer/index.html\'s script and style lists are up to date with the generator', () => {
  const html = read(path.join(root, 'src', 'renderer', 'index.html'));
  assert.equal(renderIndexHtml(html, root), html);
});

test('rendererAssets on the real src/renderer/: load-order guarantees the app depends on', () => {
  const scripts = rendererAssets(root, '.js');
  const styles = rendererAssets(root, '.css');
  const at = (list, f) => {
    const i = list.indexOf(f);
    assert.ok(i >= 0, `${f} is missing from the generated list`);
    return i;
  };

  // view-registry.js and api-http.js are read as app.js loads
  assert.ok(at(scripts, 'view-registry.js') < at(scripts, 'app.js'));
  assert.ok(at(scripts, 'api-http.js') < at(scripts, 'app.js'));
  // chat-models.js's window.ChatModels (a top-level file) is read by every chat screen as it loads
  assert.ok(at(scripts, 'chat-models.js') < at(scripts, 'views/duo/duo.js'));
  assert.ok(at(scripts, 'chat-models.js') < at(scripts, 'views/arena/arena.js'));
  assert.ok(at(scripts, 'chat-models.js') < at(scripts, 'views/workflows/builder.js'));
  // views/duo/duo-issue.js's window.DuoIssue is read by duo.js as it loads
  assert.ok(at(scripts, 'views/duo/duo-issue.js') < at(scripts, 'views/duo/duo.js'));
  // the run chat's own model and the Run screen's renderRunGates/gate-panel pieces are read by
  // runchat.js as it loads (#154)
  assert.ok(at(scripts, 'views/runchat/run-chat-model.js') < at(scripts, 'views/runchat/runchat.js'));
  assert.ok(at(scripts, 'views/run/run.js') < at(scripts, 'views/runchat/runchat.js'));
  // robots.js's window.Robots is read by duo.js, views/agents/agents.js and
  // views/backlog/backlog-po.js as they load
  assert.ok(at(scripts, 'robots.js') < at(scripts, 'views/duo/duo.js'));
  assert.ok(at(scripts, 'robots.js') < at(scripts, 'views/agents/agents.js'));
  assert.ok(at(scripts, 'robots.js') < at(scripts, 'views/backlog/backlog-po.js'));
  // every views/ script loads after every top-level one
  const firstView = scripts.findIndex((f) => f.startsWith('views/'));
  assert.ok(firstView > 0);
  assert.ok(scripts.slice(firstView).every((f) => f.startsWith('views/')));

  assert.equal(styles[0], 'style.css');
  // chat.css (the shared chat look, formerly duo.css, #154) precedes every screen that uses it
  assert.ok(at(styles, 'chat.css') < at(styles, 'views/arena/arena.css'));
  assert.ok(at(styles, 'chat.css') < at(styles, 'views/runchat/runchat.css'));
});

test('loadRule: "load: early" with no file names marks a file early, with no dependency', () => {
  assert.deepEqual(loadRule('// load: early\n', 'f.js'), { early: true, after: [] });
});

test('loadRule: "load: after a.js b.js (reason)" ignores the parenthetical reason', () => {
  assert.deepEqual(
    loadRule('// some header\n// load: after a.js b.js (because b defines something a.js needs)\n', 'f.js'),
    { early: false, after: ['a.js', 'b.js'] },
  );
});

test('loadRule: a header with no load line returns the default (not early, no dependency)', () => {
  assert.deepEqual(loadRule('// just a plain header\n', 'f.js'), { early: false, after: [] });
});

test('loadRule: an unknown rule throws', () => {
  assert.throws(() => loadRule('// load: soon\n', 'f.js'), /unknown load rule/);
});

// A temporary src/renderer/ with a handful of files and two view folders: only what rendererAssets
// reads, so a fixture file never touches the real repository's renderer.
function tmpRendererFixture(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-assets-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, 'src', 'renderer', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}

test('rendererAssets: early files first (one CSS with a "load: early" comment header), then app.js, '
  + 'then the other top-level files sorted ("x-part.js" before "x.js", a "load: after" file moved just '
  + 'past its dependency), then the views sorted by folder then file', (t) => {
  const tmp = tmpRendererFixture(t, {
    'api-http.js': '// load: early\n',
    'app.js': '// the app shell\n',
    'x.js': '// x\n',
    'x-part.js': '// x, split in two files\n',
    'z.js': '// z\n',
    'y.js': '// load: after z.js\n',
    'style.css': '/* base styles\n   load: early */\n',
    'other.css': '/* another stylesheet */\n',
    'views/b/b.js': '// view b\n',
    'views/b/b.css': '/* view b */\n',
    'views/a/a.js': '// view a\n',
  });

  assert.deepEqual(rendererAssets(tmp, '.js'), [
    'api-http.js', 'app.js', 'x-part.js', 'x.js', 'z.js', 'y.js', 'views/a/a.js', 'views/b/b.js',
  ]);
  assert.deepEqual(rendererAssets(tmp, '.css'), ['style.css', 'other.css', 'views/b/b.css']);

  // a new views/n/ folder is picked up without changing the files already placed
  fs.mkdirSync(path.join(tmp, 'src', 'renderer', 'views', 'n'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'renderer', 'views', 'n', 'n.js'), '// view n\n');
  fs.writeFileSync(path.join(tmp, 'src', 'renderer', 'views', 'n', 'n.css'), '/* view n */\n');

  assert.deepEqual(rendererAssets(tmp, '.js'), [
    'api-http.js', 'app.js', 'x-part.js', 'x.js', 'z.js', 'y.js',
    'views/a/a.js', 'views/b/b.js', 'views/n/n.js',
  ]);
  assert.deepEqual(rendererAssets(tmp, '.css'), ['style.css', 'other.css', 'views/b/b.css', 'views/n/n.css']);
});

test('rendererAssets: "load: after <file>" naming a file that does not exist throws', (t) => {
  const tmp = tmpRendererFixture(t, { 'app.js': '// load: after missing.js\n' });
  assert.throws(() => rendererAssets(tmp, '.js'), /names no file/);
});

test('rendererAssets: a load-order cycle ("a after b", "b after a") throws', (t) => {
  const tmp = tmpRendererFixture(t, {
    'a.js': '// load: after b.js\n',
    'b.js': '// load: after a.js\n',
  });
  assert.throws(() => rendererAssets(tmp, '.js'), /cycle/);
});

test('rendererAssets: a top-level file that "load: after"s a views file (a later group, not yet '
  + 'placed when the top-level group is resolved) throws the same way as a cycle', (t) => {
  const tmp = tmpRendererFixture(t, {
    'top.js': '// load: after views/late/late.js\n',
    'views/late/late.js': '// a view file\n',
  });
  assert.throws(() => rendererAssets(tmp, '.js'), /cycle/);
});

// A temporary root with just enough of every generated section (skills/, docs/screens/, README.md,
// docs/agents/ for the code map, a minimal src/renderer/) for main() to run end to end.
function tmpFullRoot(t) {
  const tmp = tmpDocsRoot(t);
  fs.mkdirSync(path.join(tmp, 'docs', 'agents'), { recursive: true });
  const rendererDir = path.join(tmp, 'src', 'renderer');
  fs.mkdirSync(rendererDir, { recursive: true });
  fs.writeFileSync(path.join(rendererDir, 'api-http.js'), '// load: early\n');
  fs.writeFileSync(path.join(rendererDir, 'app.js'), '// the app shell\n');
  fs.writeFileSync(path.join(rendererDir, 'index.html'), [
    '<!-- generated:styles -->',
    '',
    '<!-- /generated:styles -->',
    '<!-- generated:scripts -->',
    '',
    '<!-- /generated:scripts -->',
    '',
  ].join('\n'));
  return tmp;
}

test('main(): rewrites index.html\'s generated blocks; main(--derived): leaves index.html untouched', (t) => {
  const tmp = tmpFullRoot(t);
  const before = read(path.join(tmp, 'src', 'renderer', 'index.html'));

  assert.equal(main(['--derived'], tmp), 0);
  assert.equal(read(path.join(tmp, 'src', 'renderer', 'index.html')), before);

  assert.equal(main([], tmp), 0);
  const after = read(path.join(tmp, 'src', 'renderer', 'index.html'));
  assert.notEqual(after, before);
  assert.match(after, /<script src="api-http\.js"><\/script>/);
  assert.match(after, /<script src="app\.js"><\/script>/);
});

test('main(--check): reports index.html as stale when a generated line is missing or an extra one was added', (t) => {
  const tmp = tmpFullRoot(t);
  main([], tmp); // an up-to-date index.html to start from
  assert.equal(main(['--check'], tmp), 0);

  const htmlPath = path.join(tmp, 'src', 'renderer', 'index.html');
  const upToDate = read(htmlPath);

  fs.writeFileSync(htmlPath, upToDate.replace('  <script src="app.js"></script>\n', ''));
  assert.equal(main(['--check'], tmp), 1);

  fs.writeFileSync(htmlPath, upToDate.replace(
    '<!-- /generated:scripts -->',
    '  <script src="extra.js"></script>\n  <!-- /generated:scripts -->',
  ));
  assert.equal(main(['--check'], tmp), 1);
});
