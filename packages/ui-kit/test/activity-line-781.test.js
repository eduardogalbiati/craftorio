// #781: the activity line, the app's one way of saying what is running (packages/ui-kit/activity-line.js and
// activity-line.css). Acceptance tests, written before the code.
//
// The contract these tests assume:
// - dual module: require('../activity-line') in node, window.ActivityLine on the page; it needs no app.js globals.
// - ActivityLine.html({ state, text, summary, meta, reason, retry, testid }) → markup string;
//   state: pending | running | done | failed | skipped.
// - root: <div class="activity-line" data-state="<state>" data-testid="<testid>"> (data-testid only when given);
//   role="status" while running, role="alert" when failed.
// - running: .activity-line-text holds `text`; .activity-line-dots (aria-hidden) is the animated ellipsis; `meta`
//   (elapsed, "40 of 120") in .activity-line-meta.
// - done: .activity-line-check holds ✓, then `summary` (or `text` when no summary). No dots.
// - failed: `reason` (or `text`) and, with retry: { label, attrs }, a <button type="button" ... attrs>label</button>
//   (attrs is raw markup). No dots, no check.
// - pending and skipped: `text` (and `summary`, when given), no dots, no check.
// - every text is HTML-escaped (the retry's attrs are raw).
// - activity-line.css: a shimmer through `background-clip: text` on the running text with looped @keyframes; the
//   ellipsis animated; @media (prefers-reduced-motion: reduce) sets `animation: none` for both; the gradient is built
//   on var(--…) theme colours, not on fixed hex; the shine only under [data-state="running"].
// - both files registered in apps/desktop/renderer/index.html and apps/web/renderer/index.html (generated blocks);
//   packages/ui-kit/AGENTS.md lists activity-line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./page-pieces');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => require('../activity-line');
const html = (opts) => load().html(opts);

const classesOf = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
const byClass = (markup, name) => H.findEl(markup, (e) => classesOf(e).includes(name));
const rootOf = (markup) => byClass(markup, 'activity-line');
const textIn = (markup, name) => H.visibleText(byClass(markup, name)?.inner || '');
const hasClass = (markup, name) => byClass(markup, name) !== null;

// ---- the states ---------------------------------------------------------------------------------------

test('#781 each state draws one root element with class activity-line and its data-state', () => {
  for (const state of ['pending', 'running', 'done', 'failed', 'skipped']) {
    assert.equal(rootOf(html({ state, text: 'Reading' }))?.attrs['data-state'], state);
  }
});

test('#781 the root has role="status" while running and role="alert" when failed, none otherwise', () => {
  const roleOf = (state) => rootOf(html({ state, text: 'Reading' }))?.attrs.role ?? null;
  assert.equal(roleOf('running'), 'status');
  assert.equal(roleOf('failed'), 'alert');
  assert.equal(roleOf('pending'), null);
  assert.equal(roleOf('done'), null);
  assert.equal(roleOf('skipped'), null);
});

test('#781 data-testid is on the root only when given', () => {
  assert.equal(rootOf(html({ state: 'done', text: 'x', testid: 'wizard-phase-git' }))?.attrs['data-testid'], 'wizard-phase-git');
  assert.equal('data-testid' in (rootOf(html({ state: 'done', text: 'x' }))?.attrs ?? { 'data-testid': 'no root' }), false);
});

test('#781 running: the text in .activity-line-text, the hidden animated dots, and the meta in .activity-line-meta', () => {
  const markup = html({ state: 'running', text: 'Reading issues', meta: '40 of 120' });
  assert.equal(textIn(markup, 'activity-line-text'), 'Reading issues');
  assert.equal(byClass(markup, 'activity-line-dots')?.attrs['aria-hidden'], 'true');
  assert.equal(textIn(markup, 'activity-line-meta'), '40 of 120');
  assert.equal(hasClass(markup, 'activity-line-check'), false, 'no check while running');
});

test('#781 running without a meta draws no .activity-line-meta', () => {
  assert.equal(hasClass(html({ state: 'running', text: 'Reading' }), 'activity-line-meta'), false);
});

test('#781 done: the check ✓ and the summary, without dots', () => {
  const markup = html({ state: 'done', text: 'Reading the git history', summary: '312 commits' });
  assert.equal(textIn(markup, 'activity-line-check'), '✓');
  const words = H.visibleText(markup);
  assert.equal(words.includes('312 commits'), true, words);
  assert.equal(words.includes('Reading the git history'), false, `the summary takes the text's place: ${words}`);
  assert.equal(hasClass(markup, 'activity-line-dots'), false, 'no dots');
});

test('#781 done with no summary shows the text', () => {
  assert.equal(H.visibleText(html({ state: 'done', text: 'Read the files' })).includes('Read the files'), true);
});

test('#781 failed: the reason and the retry button, without dots nor check', () => {
  const markup = html({ state: 'failed', text: 'Reading', reason: 'The budget is spent', retry: { label: 'Retry', attrs: 'data-act="retry" data-testid="x"' } });
  assert.equal(H.visibleText(markup).includes('The budget is spent'), true);
  const button = H.findEl(markup, (e) => e.name === 'button');
  assert.equal(button?.attrs.type, 'button');
  assert.equal(button?.attrs['data-act'], 'retry', 'attrs is raw markup');
  assert.equal(button?.attrs['data-testid'], 'x');
  assert.equal(H.visibleText(button?.inner || ''), 'Retry');
  assert.equal(hasClass(markup, 'activity-line-dots'), false, 'no dots');
  assert.equal(hasClass(markup, 'activity-line-check'), false, 'no check');
});

test('#781 failed with no reason shows the text, and with no retry draws no button', () => {
  const markup = html({ state: 'failed', text: 'It failed' });
  assert.equal(H.visibleText(markup).includes('It failed'), true);
  assert.equal(H.findEl(markup, (e) => e.name === 'button'), null);
});

test('#781 pending and skipped: the text and the summary, without dots nor check', () => {
  for (const state of ['pending', 'skipped']) {
    const markup = html({ state, text: 'The Oracle', summary: 'not needed' });
    const words = H.visibleText(markup);
    assert.equal(words.includes('The Oracle'), true, `${state}: ${words}`);
    assert.equal(words.includes('not needed'), true, `${state}: ${words}`);
    assert.equal(hasClass(markup, 'activity-line-dots'), false, `${state}: no dots`);
    assert.equal(hasClass(markup, 'activity-line-check'), false, `${state}: no check`);
  }
});

// ---- escaping -----------------------------------------------------------------------------------------

test('#781 every text is escaped: text, summary, meta, reason and the retry\'s label', () => {
  const evil = '<img src=x>';
  const markups = [
    html({ state: 'running', text: evil }),
    html({ state: 'running', text: 'x', meta: evil }),
    html({ state: 'done', text: 'x', summary: evil }),
    html({ state: 'failed', text: 'x', reason: evil }),
    html({ state: 'failed', text: 'x', retry: { label: evil, attrs: '' } }),
    html({ state: 'skipped', text: 'x', summary: evil }),
  ];
  for (const markup of markups) {
    assert.equal(H.findEl(markup, (e) => e.name === 'img'), null, markup);
    assert.equal(markup.includes('&lt;img'), true, markup);
  }
});

// ---- the module on the page ---------------------------------------------------------------------------

test('#781 on the page it is window.ActivityLine, with no app.js global around', () => {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'activity-line.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.window.ActivityLine?.html, 'function');
  const markup = String(sandbox.window.ActivityLine.html({ state: 'running', text: 'a & b' }));
  assert.equal(markup.includes('a &amp; b'), true, markup);
});

// ---- the CSS ------------------------------------------------------------------------------------------

const css = () => fs.readFileSync(path.join(__dirname, '..', 'activity-line.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// every rule: { selector, body, media } (media: the @media it is inside, or null)
function rulesOf(text, media = null) {
  const out = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (end < text.length && depth) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}') depth--;
      end++;
    }
    const selector = text.slice(at, open).trim();
    const body = text.slice(open + 1, end - 1);
    if (selector.startsWith('@media')) out.push(...rulesOf(body, selector));
    else out.push({ selector, body, media });
    at = end;
  }
  return out;
}

const RUNNING = /\[data-state=["']?running["']?\]/;
const CLIP = /(^|[\s;-])background-clip\s*:\s*text/;
const ANIMATED = /animation(-name)?\s*:\s*(?!none)/;
const plainRules = () => rulesOf(css()).filter((r) => !r.media && !r.selector.startsWith('@'));

test('#781 CSS: the running text shines through background-clip: text, on a looped animation with its @keyframes', () => {
  const rules = plainRules().filter((r) => r.selector.includes('activity-line-text') && CLIP.test(r.body));
  assert.equal(rules.length > 0, true, 'a rule of .activity-line-text with background-clip: text');
  const shine = rules.map((r) => r.body).join(';');
  assert.match(shine, ANIMATED);
  assert.match(shine, /infinite/, 'looped');
  assert.match(css(), /@keyframes\s+[\w-]+/);
});

test('#781 CSS: the shine is only under [data-state="running"]', () => {
  const clipped = plainRules().filter((r) => CLIP.test(r.body));
  assert.equal(clipped.length > 0, true, 'a rule with background-clip: text');
  for (const r of clipped) {
    for (const selector of r.selector.split(',')) assert.match(selector, RUNNING, `"${selector.trim()}" shines outside running`);
  }
});

test('#781 CSS: the shine\'s gradient is built on theme colours, never on a fixed colour', () => {
  const gradients = plainRules().filter((r) => /gradient\(/.test(r.body));
  assert.equal(gradients.length > 0, true, 'a rule with a gradient');
  for (const r of gradients) {
    assert.match(r.body, /var\(--/, `${r.selector}: var(--…)`);
    assert.doesNotMatch(r.body, /#[0-9a-f]{3,8}\b|\brgba?\(\s*\d/i, `${r.selector}: no fixed colour`);
  }
});

test('#781 CSS: the ellipsis is animated', () => {
  const dots = plainRules().filter((r) => r.selector.includes('activity-line-dots'));
  assert.match(dots.map((r) => r.body).join(';'), ANIMATED);
});

test('#781 CSS: under prefers-reduced-motion both the shine and the ellipsis have animation: none', () => {
  const reduced = rulesOf(css()).filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.media || ''));
  for (const part of ['activity-line-text', 'activity-line-dots']) {
    const body = reduced.filter((r) => r.selector.includes(part)).map((r) => r.body).join(';');
    assert.match(body, /animation\s*:\s*none/, `.${part}`);
  }
});

// ---- registered -----------------------------------------------------------------------------------------

for (const app of ['desktop', 'web']) {
  test(`#781 apps/${app}/renderer/index.html loads activity-line.js and activity-line.css`, () => {
    const page = fs.readFileSync(path.join(ROOT, 'apps', app, 'renderer', 'index.html'), 'utf8');
    assert.equal(page.includes('<script src="../../../packages/ui-kit/activity-line.js"></script>'), true, 'the script');
    assert.equal(page.includes('<link rel="stylesheet" href="../../../packages/ui-kit/activity-line.css" />'), true, 'the stylesheet');
  });
}

test('#781 packages/ui-kit/AGENTS.md lists the activity line', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'AGENTS.md'), 'utf8'), /activity-line/);
});
