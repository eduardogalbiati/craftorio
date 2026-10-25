// The deterministic UI checks that run before the UI reviewer's model (#387). The screenshot pass
// (scripts/screenshot.js) runs axe-core (`color-contrast`, `target-size`) on each captured state and
// keeps the page's markup; packages/engine/engine/screenshot-step.js turns both into findings in the shape of
// code_review's `ui_findings` (element, problem, convention, screenshot, blocking) plus `rule`,
// `source` and `baseline`, which reach the ui_reviewer's prompt as `axe_findings`: it keeps each one or
// dismisses it with a written reason. A violation the original side of the same screen already has
// is a baseline (a ratchet): reported, never blocking.
//   axeFindings(results, { screen, changed })   axe's `{ violations }` → findings
//   nativeControlFindings(html, { screen })     a bare <select>, date or datetime-local field → findings
//   screenChecks({ modified, original, screen }) both checks of one screen, baselines from the original
//   checksPath(png), readChecks(png)             the `<name>.<side>.checks.json` the pass writes
'use strict';

const fs = require('fs');

// the axe rules the pass runs (AXE_RULES) and the convention each one checks
const AXE_RULES = {
  'color-contrast': 'design-system: colours (text contrast at least 4.5:1)',
  'target-size': 'ui-conventions: targets a person can hit (24 x 24 px, WCAG 2.5.8)',
};
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);
const MAX_TARGETS = 3;

const targetOf = (node) => [].concat(node?.target || []).join(' ');

// axe's results ({ violations: [{ id, impact, help, nodes: [{ target, failureSummary }] }] }) → one
// finding per violated rule; `changed: false` (a screen the change did not touch) makes it a baseline
function axeFindings(results, { screen = '', changed = true } = {}) {
  const out = [];
  for (const v of results?.violations || []) {
    const nodes = (v.nodes || []).filter((n) => targetOf(n));
    if (!nodes.length) continue;
    const targets = nodes.slice(0, MAX_TARGETS).map(targetOf);
    const more = nodes.length > MAX_TARGETS ? ` (+${nodes.length - MAX_TARGETS} more)` : '';
    const detail = nodes[0].failureSummary ? `: ${String(nodes[0].failureSummary).replace(/\s+/g, ' ').trim()}` : '';
    out.push({
      element: `${targets.join(', ')}${more}`,
      problem: `axe ${v.id}${v.impact ? ` (${v.impact})` : ''}: ${v.help || v.description || v.id}${detail}`,
      convention: AXE_RULES[v.id] || `ui-conventions: axe ${v.id}`,
      screenshot: screen,
      blocking: Boolean(changed) && BLOCKING_IMPACTS.has(v.impact),
      rule: v.id,
      source: 'axe',
      baseline: !changed,
    });
  }
  return out;
}

const NATIVE_RE = /<(select)\b([^>]*)>|<input\b([^>]*\stype\s*=\s*["']?(date|datetime-local)\b[^>]*)>/gi;
const attr = (attrs, name) => (attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];

// a bare <select>, <input type="date"> or <input type="datetime-local"> in a screen's markup: each
// opens in the operating system's light colours on the dark app (ui-conventions: native controls themed)
function nativeControlFindings(html, { screen = '', changed = true } = {}) {
  const out = [];
  for (const m of String(html || '').matchAll(NATIVE_RE)) {
    const kind = m[1] ? 'select' : m[4].toLowerCase();
    const attrs = m[2] ?? m[3] ?? '';
    const testid = attr(attrs, 'data-testid');
    const id = attr(attrs, 'id');
    const name = attr(attrs, 'name');
    const tag = kind === 'select' ? 'select' : `input[type=${kind}]`;
    const element = testid ? `${tag}[data-testid=${testid}]` : id ? `${tag}#${id}` : name ? `${tag}[name=${name}]` : tag;
    out.push({
      element,
      problem: `native ${kind === 'select' ? 'select list' : `${kind} picker`}: it opens in the operating system's light colours on the dark app; use a themed component`,
      convention: 'ui-conventions: native controls themed',
      screenshot: screen,
      // not blocking until the themed components exist (#383); a baseline never is
      blocking: false,
      rule: 'native-control',
      source: 'markup',
      baseline: !changed,
    });
  }
  return out;
}

// Both checks of one screen: `modified` and `original` are { axe, html } of its two sides (original
// optional: a screen the change adds). An axe node (same rule and target) or a native control the
// original side has too is a baseline; a rule's new nodes stay the change's finding.
function screenChecks({ modified = {}, original = null, screen = '' } = {}) {
  const known = new Set((original?.axe?.violations || []).flatMap((v) => (v.nodes || []).map((n) => `${v.id} ${targetOf(n)}`)));
  const split = (keep) => ({ violations: (modified.axe?.violations || []).map((v) => ({ ...v, nodes: (v.nodes || []).filter((n) => known.has(`${v.id} ${targetOf(n)}`) === keep) })) });
  const controls = new Set(nativeControlFindings(original?.html).map((f) => f.element));
  return [
    ...axeFindings(split(false), { screen }),
    ...axeFindings(split(true), { screen, changed: false }),
    ...nativeControlFindings(modified.html, { screen }).map((f) => (controls.has(f.element) ? { ...f, baseline: true } : f)),
  ];
}

// `<name>.<side>.png` → `<name>.<side>.checks.json`, the checks the screenshot pass writes beside it
const checksPath = (png) => String(png).replace(/\.png$/i, '') + '.checks.json';

// the checks file of a capture → { axe, html }, or null when it is missing, unreadable or failed
function readChecks(png) {
  try {
    const data = JSON.parse(fs.readFileSync(checksPath(png), 'utf8'));
    return data && !data.error ? data : null;
  } catch { return null; }
}

module.exports = {
  AXE_RULES,
  axeFindings,
  checksPath,
  nativeControlFindings,
  readChecks,
  screenChecks,
};
