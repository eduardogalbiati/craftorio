// #77: shared docs generated from per-feature fragments instead of hand-edited shared lists.
// #152: apps/desktop/renderer/index.html's <link>/<script> lists are generated the same way.
// #157: README sections features used to hand-edit (workflows, engine, workspace, structure) are
// generated from docs/features/*.md fragments too.
// Seams: scripts/docs.js's own exports (renderReadme, missingHeaders, codeMap, main, loadRule,
// rendererAssets, renderIndexHtml, featurePieces, featureSection).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const {
  codeMap, featurePieces, featureSection, loadRule, main, missingHeaders, renderIndexHtml,
  rendererAssets, renderReadme,
} = require('../../../scripts/docs.js');

const root = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

test('README.md tables are up to date with the generator', () => {
  const readme = read(path.join(root, 'README.md'));
  assert.equal(renderReadme(readme, root), readme);
});

test('every source file has a header comment the code map can build from', () => {
  assert.deepEqual(missingHeaders(root), []);
});

test('the generated code map documents the channel manifest folder', () => {
  assert.match(codeMap(root), /packages\/engine\/service\/manifest\.js/);
  assert.match(codeMap(root), /packages\/engine\/service\/channels\//);
});

// A temporary root with just apps/desktop/renderer/views/: enough for codeMap's own views-folder rows
// (it does not read skills/, docs/screens/ or README.md).
function tmpViewsRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-map-views-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, 'apps', 'desktop', 'renderer', 'views', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tmp;
}

test('the generated code map adds no views/ rows when apps/desktop/renderer/views/ does not exist', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-map-no-views-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // the "Adding things" section mentions `apps/desktop/renderer/views/<view>/` by itself: only a generated
  // row (naming a real folder) counts as evidence of a screen folder.
  assert.doesNotMatch(codeMap(tmp), /\| `apps\/desktop\/renderer\/views\/[^`]+\/` \|/);
});

test('the generated code map adds one row per view folder, listing only its .js/.css files, sorted', (t) => {
  const tmp = tmpViewsRoot(t, {
    'foo/b.js': '// b\n',
    'foo/a.js': '// a\n',
    'foo/a.css': '/* a */\n',
    'foo/readme.md': 'not js or css\n',
  });
  const map = codeMap(tmp);
  assert.match(map, /\| `apps\/desktop\/renderer\/views\/foo\/` \| The foo screen's folder \(registered with `registerView`\): `a\.css`, `a\.js`, `b\.js`\. \|/);
  assert.doesNotMatch(map, /readme\.md/);
});

// A temporary copy of only what the generator reads (skills/, docs/, README.md): editing one
// skill's summary there must not touch the real repository's files. All of docs/ (#248, #251):
// the README fragments and the engine topics are generator inputs too.
function tmpDocsRoot(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-root-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'skills'), path.join(tmp, 'skills'), { recursive: true });
  fs.cpSync(path.join(root, 'docs'), path.join(tmp, 'docs'), { recursive: true });
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

// #157: README sections generated from docs/features/*.md fragments.

// A temporary root with just docs/features/<name>.md, built from the given { name: content } map:
// enough for featurePieces/featureSection, which read nothing else.
function tmpFeaturesRoot(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-features-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dir = path.join(tmp, 'docs', 'features');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return tmp;
}

test('featurePieces: sorts by order (a piece\'s own order wins over its file\'s frontmatter order), '
  + 'then by file name, then by position in the file; a piece with no order defaults to 999', (t) => {
  const tmp = tmpFeaturesRoot(t, {
    'order-999.md': '<!-- section:workflows -->\nDefault order piece\n',
    'order-10.md': '---\norder: 10\n---\n<!-- section:workflows -->\nFirst piece order10\n'
      + '<!-- section:workflows -->\nSecond piece order10\n',
    'order-10-other.md': '---\norder: 10\n---\n<!-- section:workflows -->\nOther order10 file\n',
    'order-1-override.md': '---\norder: 10\n---\n<!-- section:workflows order:1 -->\nOverride piece\n',
  });

  const texts = featurePieces(tmp).filter((p) => p.section === 'workflows').map((p) => p.text);
  assert.deepEqual(texts, [
    'Override piece', 'Other order10 file', 'First piece order10', 'Second piece order10', 'Default order piece',
  ]);
});

test('featurePieces: a fragment with pieces for two different sections feeds both', (t) => {
  const tmp = tmpFeaturesRoot(t, {
    'two-sections.md': '<!-- section:engine -->\nEngine piece\n<!-- section:workspace -->\nWorkspace piece\n',
  });

  assert.equal(featureSection('engine', tmp), 'Engine piece');
  assert.equal(featureSection('workspace', tmp), 'Workspace piece');
});

test('featureSection: prose sections (workflows, engine, workspace) join pieces with a blank line', (t) => {
  const tmp = tmpFeaturesRoot(t, {
    'a.md': '<!-- section:engine -->\nFirst paragraph\n',
    'b.md': '<!-- section:engine -->\nSecond paragraph\n',
  });
  assert.equal(featureSection('engine', tmp), 'First paragraph\n\nSecond paragraph');
});

test('featureSection: list sections (local-hero) join pieces with a single newline, no blank line', (t) => {
  const tmp = tmpFeaturesRoot(t, {
    'a.md': '<!-- section:local-hero -->\n- bullet one\n',
    'b.md': '<!-- section:local-hero -->\n- bullet two\n',
  });
  assert.equal(featureSection('local-hero', tmp), '- bullet one\n- bullet two');
});

test('featureSection: fenced sections (workspace-tree, structure) wrap their joined pieces in ``` lines', (t) => {
  const tmp = tmpFeaturesRoot(t, {
    'a.md': '<!-- section:structure -->\nsrc/foo.js  does foo\n',
    'b.md': '<!-- section:structure -->\nsrc/bar.js  does bar\n',
  });
  assert.equal(featureSection('structure', tmp), '```\nsrc/foo.js  does foo\nsrc/bar.js  does bar\n```');
});

test('featurePieces: an unknown section name throws, naming the file and the section', (t) => {
  const tmp = tmpFeaturesRoot(t, { 'bad.md': '<!-- section:not-a-real-section -->\ntext\n' });
  assert.throws(() => featurePieces(tmp), /docs\/features\/bad\.md.*not-a-real-section/);
});

test('featurePieces: non-blank text before the first section line throws', (t) => {
  const tmp = tmpFeaturesRoot(t, { 'bad.md': 'some stray prose\n<!-- section:workflows -->\ntext\n' });
  assert.throws(() => featurePieces(tmp), /docs\/features\/bad\.md.*text before the first/);
});

test('featurePieces: a fragment with no section line throws', (t) => {
  const tmp = tmpFeaturesRoot(t, { 'bad.md': '---\norder: 1\n---\n' });
  assert.throws(() => featurePieces(tmp), /docs\/features\/bad\.md.*no <!-- section:<name> --> line/);
});

test('renderReadme: the local-hero markers nested inside the workflows piece get filled too', (t) => {
  const tmp = tmpDocsRoot(t);
  const rendered = renderReadme(read(path.join(tmp, 'README.md')), tmp);

  const openNested = rendered.indexOf('<!-- generated:local-hero -->');
  const closeNested = rendered.indexOf('<!-- /generated:local-hero -->');
  const closeWorkflows = rendered.indexOf('<!-- /generated:workflows -->');
  assert.ok(openNested > 0 && closeNested > openNested, 'the nested local-hero markers should both be present');
  assert.ok(closeNested < closeWorkflows, 'the nested local-hero markers should sit inside the workflows section');
  assert.match(
    rendered.slice(openNested, closeNested),
    /Each run still gets its own git worktree/,
  );
});

test('main(--check): a docs/features/ fragment edited without regenerating makes the README stale; '
  + 'main() makes --check pass again', (t) => {
  const tmp = tmpDocsRoot(t);
  fs.mkdirSync(path.join(tmp, 'docs', 'agents'), { recursive: true }); // main() always (re)writes the code map
  const fragmentPath = path.join(tmp, 'docs', 'features', 'software-development.md');
  fs.writeFileSync(fragmentPath, read(fragmentPath).replace('Software development flow', 'Changed flow name'));

  assert.equal(main(['--check'], tmp), 1);
  assert.equal(main([], tmp), 0);
  assert.equal(main(['--check'], tmp), 0);
  assert.match(read(path.join(tmp, 'README.md')), /Changed flow name/);
});

test('main(): writes docs/agents/test-map.md (the code → tests map, #219), saying why there is no map for a project with no tests', (t) => {
  const tmp = tmpFullRoot(t);
  assert.equal(main([], tmp), 0);
  const map = read(path.join(tmp, 'docs', 'agents', 'test-map.md'));
  assert.match(map, /^# Code → tests map/);
  assert.match(map, /No map: /, 'a folder that is not a git project has no files to map');
});

// #152: apps/desktop/renderer/index.html's <link>/<script> lists.

test('apps/desktop/renderer/index.html\'s script and style lists are up to date with the generator', () => {
  const html = read(pageFileOf('index.html'));
  assert.equal(renderIndexHtml(html, root), html);
});

test('rendererAssets on the real desktop page: load-order guarantees the app depends on', () => {
  // the page-relative names: the layer's prefix (../../../packages/ui-kit/, ../../../fronts/<id>/) dropped
  const name = (f) => f.replace(/^(\.\.\/)+(packages|fronts)\/[^/]+\//, '');
  const scripts = rendererAssets(root, '.js').map(name);
  const styles = rendererAssets(root, '.css').map(name);
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
  // every views/ script loads after every top-level script of the UI kit; after the first view only
  // views/ scripts and the fronts' own root files (their Home cards, <id>-home.js) follow
  const raw = rendererAssets(root, '.js');
  const firstView = scripts.findIndex((f) => f.startsWith('views/'));
  assert.ok(firstView > 0);
  assert.ok(raw.slice(firstView).every((f) => name(f).startsWith('views/') || /^(\.\.\/)+fronts\/[^/]+\/[^/]+\.js$/.test(f)), 'after the first view: views and the fronts\' root files only');

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

// A temporary apps/desktop/renderer/ with a handful of files and two view folders: only what rendererAssets
// reads, so a fixture file never touches the real repository's renderer.
function tmpRendererFixture(t, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-assets-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, 'apps', 'desktop', 'renderer', rel);
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
  fs.mkdirSync(path.join(tmp, 'apps', 'desktop', 'renderer', 'views', 'n'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'apps', 'desktop', 'renderer', 'views', 'n', 'n.js'), '// view n\n');
  fs.writeFileSync(path.join(tmp, 'apps', 'desktop', 'renderer', 'views', 'n', 'n.css'), '/* view n */\n');

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
// docs/agents/ for the code map, a minimal apps/desktop/renderer/) for main() to run end to end.
function tmpFullRoot(t) {
  const tmp = tmpDocsRoot(t);
  fs.mkdirSync(path.join(tmp, 'docs', 'agents'), { recursive: true });
  const rendererDir = path.join(tmp, 'apps', 'desktop', 'renderer');
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
  const before = read(path.join(tmp, 'apps', 'desktop', 'renderer', 'index.html'));

  assert.equal(main(['--derived'], tmp), 0);
  assert.equal(read(path.join(tmp, 'apps', 'desktop', 'renderer', 'index.html')), before);

  assert.equal(main([], tmp), 0);
  const after = read(path.join(tmp, 'apps', 'desktop', 'renderer', 'index.html'));
  assert.notEqual(after, before);
  assert.match(after, /<script src="api-http\.js"><\/script>/);
  assert.match(after, /<script src="app\.js"><\/script>/);
});

test('main(--check): reports index.html as stale when a generated line is missing or an extra one was added', (t) => {
  const tmp = tmpFullRoot(t);
  main([], tmp); // an up-to-date index.html to start from
  assert.equal(main(['--check'], tmp), 0);

  const htmlPath = path.join(tmp, 'apps', 'desktop', 'renderer', 'index.html');
  const upToDate = read(htmlPath);

  fs.writeFileSync(htmlPath, upToDate.replace('  <script src="app.js"></script>\n', ''));
  assert.equal(main(['--check'], tmp), 1);

  fs.writeFileSync(htmlPath, upToDate.replace(
    '<!-- /generated:scripts -->',
    '  <script src="extra.js"></script>\n  <!-- /generated:scripts -->',
  ));
  assert.equal(main(['--check'], tmp), 1);
});

// #338: the channel reference, generated from the app's manifest and its schemas (derived like the
// code map: rebuilt by --derived, gitignored).
test('#338 main(--derived) writes docs/agents/channels.md: each channel with its arguments and result', (t) => {
  const tmp = tmpFullRoot(t);
  assert.equal(main(['--derived'], tmp), 0);
  const file = path.join(tmp, 'docs', 'agents', 'channels.md');
  assert.equal(fs.existsSync(file), true, 'no channel reference written');
  const ref = read(file);
  for (const channel of ['runs:setTitle', 'runs:events', 'roadmap:get', 'projects:list']) assert.match(ref, new RegExp(channel), channel);
  const setTitle = ref.slice(ref.indexOf('runs:setTitle'), ref.indexOf('runs:setTitle') + 1500);
  assert.match(setTitle, /title/);
  assert.match(setTitle, /200/, 'the title limit is in the reference');
  assert.match(read(path.join(root, '.gitignore')), /^docs\/agents\/channels\.md$/m);
});
