// #644 (first-project onboarding, step 7 of docs/work/first-project-onboarding/plan.md, #629): acceptance
// tests written before the code.
// - scripts/screenshot/views/onboarding.js is a screenshot view of the runner (scripts/screenshot.js's
//   VIEWS / parseArgs, the seam every other view goes through) with the wizard's six states as --mode:
//   start, repository, cloning, access-error, analysis, review (each captured with the runner's axe checks,
//   as every view is; test/screenshot-seed-modules-249.test.js runs its seed for every mode by itself);
// - the "Next steps" card (fronts/analyser/views/project/project.js) takes its texts from onboarding.* keys
//   (today project.next_steps_*), each in English and Portuguese; the wizard, its tray and its review
//   (fronts/build/views/projects/project-wizard.js) already do, and apps/desktop/test/i18n-every-screen-330
//   already fails any literal visible text in both files;
// - docs: a page for the wizard in docs/agents/renderer/ and the decisions of #629 in docs/agents/decisions.md.
// Plain Node only: no Electron window is opened. Anything #644 creates is loaded inside the tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODES = ['start', 'repository', 'cloning', 'access-error', 'analysis', 'review'];
const PROJECT_PAGE = path.join(ROOT, 'fronts', 'analyser', 'views', 'project', 'project.js');
const WIZARD = path.join(ROOT, 'fronts', 'build', 'views', 'projects', 'project-wizard.js');
const CATALOGS = path.join(ROOT, 'packages', 'shared', 'i18n');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const catalogs = () => ({ en: readJson(path.join(CATALOGS, 'en.json')), pt: readJson(path.join(CATALOGS, 'pt-BR.json')) });
const text = (v) => (v && typeof v === 'object' ? Object.values(v).join(' ') : v); // a plural { one, other }
const keyLiterals = (src) => [...src.matchAll(/['"`]([a-z][\w-]*\.[a-z][\w.-]*)['"`]/g)].map((m) => m[1]);

test('--view onboarding is a screenshot view whose modes are the wizard\'s six states', () => {
  const { VIEWS, parseArgs } = require('../scripts/screenshot');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'screenshot', 'views', 'onboarding.js')), 'scripts/screenshot/views/onboarding.js exists');
  const view = VIEWS.onboarding;
  assert.ok(view, 'VIEWS has the onboarding view');
  assert.deepEqual([...view.modes].sort(), [...MODES].sort());
  assert.equal(typeof view.open, 'function', 'the view opens its screen (open)');
  for (const mode of MODES) assert.equal(parseArgs(['--view', 'onboarding', '--mode', mode]).mode, mode);
  assert.throws(() => parseArgs(['--view', 'onboarding', '--mode', 'no-such-state']), /does not apply to onboarding/);
});

test('the "Next steps" card takes every text from onboarding.* keys, in English and Portuguese', () => {
  const src = fs.readFileSync(PROJECT_PAGE, 'utf8');
  const { en, pt } = catalogs();
  // catalog keys only (the card's dismissal is also stored under the localStorage key multiagent.nextSteps)
  const cardKeys = [...new Set(keyLiterals(src).filter((k) => /next_?steps?/i.test(k) && (k in en || k.startsWith('onboarding.'))))];
  const notOnboarding = cardKeys.filter((k) => !k.startsWith('onboarding.'));
  assert.deepEqual(notOnboarding, [], `the Next steps card's keys outside onboarding.*: ${notOnboarding.join(', ')}`);
  assert.ok(cardKeys.length >= 4, `the card's title, dismiss and entries use onboarding.* keys (found: ${cardKeys.join(', ') || 'none'})`);
  for (const k of cardKeys) {
    assert.ok(String(text(en[k]) || '').trim(), `en.json has ${k}`);
    assert.ok(String(text(pt[k]) || '').trim(), `pt-BR.json has ${k}`);
  }
});

test('every onboarding.* key the wizard and the Next steps card use is in both catalogs, the same set of onboarding.* keys in each', () => {
  const { en, pt } = catalogs();
  const enKeys = Object.keys(en).filter((k) => k.startsWith('onboarding.')).sort();
  const ptKeys = Object.keys(pt).filter((k) => k.startsWith('onboarding.')).sort();
  assert.deepEqual(ptKeys, enKeys);
  const used = [WIZARD, PROJECT_PAGE].flatMap((f) => keyLiterals(fs.readFileSync(f, 'utf8')).filter((k) => k.startsWith('onboarding.')));
  assert.ok(used.some((k) => keyLiterals(fs.readFileSync(PROJECT_PAGE, 'utf8')).includes(k)), 'the project page (Next steps card) uses onboarding.* keys');
  const missing = [...new Set(used)].filter((k) => !(k in en) || !(k in pt));
  assert.deepEqual(missing, []);
});

test('docs: a page for the wizard in docs/agents/renderer/ and the decisions of #629 in decisions.md', () => {
  const dir = path.join(ROOT, 'docs', 'agents', 'renderer');
  const pages = fs.readdirSync(dir).filter((f) => /onboarding|wizard/i.test(f) && f.endsWith('.md'));
  assert.ok(pages.length > 0, 'docs/agents/renderer/ has a page whose name mentions onboarding or wizard');
  const body = pages.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.match(body, /project-wizard\.js/, 'the page names the wizard\'s file');
  assert.match(body, /#629/, 'the page cites #629');
  const decisions = fs.readFileSync(path.join(ROOT, 'docs', 'agents', 'decisions.md'), 'utf8');
  assert.match(decisions, /#629\b/, 'decisions.md records the decisions of #629');
});
