// #297 (1): the agent editor's robot preview was tiny. agents.css sizes the editor robot (#ag-robot,
// class .ag-robot) 280x280 (200x200 under 900px), but the Analytics Agents tab
// (views/analytics/analytics-insights.css, #280) added its own unscoped `.ag-robot { width: 44px }`,
// loaded later, so it won. The fix keeps the two apart: the Analytics tab's robot class is renamed
// (e.g. `an-robot`) or its rules are scoped under the tab's container. These checks accept either.
// The stylesheets are read as text and split into rules by a small brace parser (no CSS library).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pageDirs, pageFile, pageFiles } = require('../../../scripts/source-tree');
const PAGE_ROOT = path.join(__dirname, '..', '..', '..');
// a page file by its page-relative name, wherever its layer is (phase 3 of the reorganisation study)
const page = (rel) => pageFile(PAGE_ROOT, rel);
void pageDirs; void pageFiles; void page;

const AGENTS_DIR = path.dirname(page('views/agents/agents.js'));
const ANALYTICS_DIR = path.dirname(page('views/analytics/analytics.js'));

function cssFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith('.css')) out.push(p);
  }
  return out;
}

/**
 * The style rules of a stylesheet: [{ selectors: [string], body: string, media: string|null }]
 * (`media`: the prelude of the enclosing @media block, if any). Comments are dropped.
 */
function rulesOf(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  function walk(text, media) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).replace(/^[\s;}]+/, '').trim();
      // the matching close brace
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container)\b/.test(prelude)) walk(body, /^@media\b/.test(prelude) ? prelude : media);
      } else if (prelude) {
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()).filter(Boolean), body, media });
      }
      i = j;
    }
  }
  walk(src, null);
  return rules;
}

// the first compound selector of a complex selector (before the first descendant/child/sibling combinator)
const firstCompound = (sel) => sel.trim().split(/\s*[>+~]\s*|\s+/)[0];
const hasClass = (compound, cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(compound);
const rel = (p) => path.relative(path.join(__dirname, '..', '..', '..'), p).replace(/\\/g, '/');

test('#297: no stylesheet outside the Agents screen targets an unscoped .ag-robot (it would resize the editor preview)', () => {
  const offenders = [];
  for (const file of pageFiles(PAGE_ROOT, { match: /\.css$/ }).map((f) => path.join(PAGE_ROOT, f.file))) {
    if (file.startsWith(AGENTS_DIR + path.sep)) continue;
    for (const r of rulesOf(fs.readFileSync(file, 'utf8'))) {
      for (const sel of r.selectors) if (hasClass(firstCompound(sel), 'ag-robot')) offenders.push(`${rel(file)}: "${sel}"`);
    }
  }
  assert.deepEqual(offenders, [], `rules that target .ag-robot without a scoping ancestor, outside apps/desktop/renderer/views/agents/:\n${offenders.join('\n')}`);
});

test('#297: agents.css still makes the editor robot 280px, and 200px in the under-900px media query', () => {
  const rules = rulesOf(fs.readFileSync(path.join(AGENTS_DIR, 'agents.css'), 'utf8'));
  const robot = (r) => r.selectors.some((s) => /[.#]ag-robot(?![\w-])/.test(s) && !/\bsvg\b/.test(s));
  const big = rules.filter((r) => !r.media && robot(r));
  assert.ok(big.some((r) => /(^|[;\s])width\s*:\s*280px/.test(r.body) && /(^|[;\s])height\s*:\s*280px/.test(r.body)),
    `an editor robot rule (outside any media query) with width and height 280px; found: ${JSON.stringify(big.map((r) => `${r.selectors.join(', ')} { ${r.body.trim()} }`))}`);
  const narrow = rules.filter((r) => r.media && /max-width\s*:\s*900px/.test(r.media) && robot(r));
  assert.ok(narrow.some((r) => /width\s*:\s*200px/.test(r.body) && /height\s*:\s*200px/.test(r.body)),
    `an editor robot rule inside @media (max-width: 900px) with width and height 200px; found: ${JSON.stringify(narrow.map((r) => r.selectors.join(', ')))}`);
});

test('#297: the Analytics Agents tab still sizes its robot at 44px, with the class its markup uses', () => {
  // the class the Analytics Agents tab gives its robot's element (renamed or not)
  const js = fs.readFileSync(path.join(ANALYTICS_DIR, 'analytics-agents.js'), 'utf8');
  const classAttr = /<span class="([^"]*robot[^"]*)"/.exec(js)?.[1];
  assert.ok(classAttr, 'the robot <span class="…robot…"> of analytics-agents.js\' card head was not found');
  const classes = classAttr.split(/\s+/).filter((c) => /robot/.test(c));
  const rules = cssFiles(ANALYTICS_DIR).flatMap((f) => rulesOf(fs.readFileSync(f, 'utf8')));
  const sized = rules.filter((r) => /(^|[;\s])width\s*:\s*44px/.test(r.body)
    && r.selectors.some((s) => !/\bsvg\b/.test(s) && classes.some((c) => hasClass(s.trim().split(/\s*[>+~]\s*|\s+/).pop(), c))));
  assert.ok(sized.length, `a rule in apps/desktop/renderer/views/analytics/*.css sizing .${classes.join('/.')} at width: 44px`);
});
