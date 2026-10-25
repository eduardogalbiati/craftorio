// #412 the header without the run's controls. Acceptance tests written before the code.
// apps/desktop/renderer/index.html's <header class="topbar"> is read as markup (test/roadmap-status-helpers.js's
// parser); the page's scripts are the ones index.html loads (test/renderer-app-harness.js pageScripts).
//
// Decided:
// - Gone from the header: the run's status pill and id (#run-meta), the KPIs (.kpis: Time, Sessions,
//   Tokens, Reasoning, Cost, All runs), Open logs (#btn-open-dir), Start (#btn-quick-start), Stop
//   (#btn-stop) and Pause (#btn-pause). Stop and Pause live on the Run screen's tab row
//   (test/renderer-run-tabs-410.test.js).
// - The 24/7 chip (#occupancy-chip) and the usage widget (#usage-widget) come right after the
//   Project select, before the top right corner (.header-right).
// - The account (#account-wrap) is the last thing at the right end, after the Oracle button and the
//   notifications bell (the Oracle's button is put before .notif-wrap by views/oracle/oracle.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./roadmap-status-helpers');
const { pageScripts, RENDERER } = require('./renderer-app-harness');

const html = () => fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
function header() {
  const h = H.findEl(html(), (e) => e.name === 'header' && String(e.attrs.class || '').split(/\s+/).includes('topbar'));
  assert.ok(h, '<header class="topbar"> not found in index.html');
  return h.outer;
}
const cls = (e) => String(e.attrs.class || '').split(/\s+/).filter(Boolean);
const byId = (markup, id) => H.findEl(markup, (e) => e.attrs.id === id);
const REMOVED_IDS = ['run-meta', 'run-status', 'run-id', 'kpi-time', 'kpi-sessions', 'kpi-tokens', 'kpi-reasoning', 'kpi-cost', 'kpi-all', 'kpi-all-value', 'btn-open-dir', 'btn-quick-start'];

test('#412 header: the run\'s status and id (#run-meta) and the KPIs (.kpis) are gone', () => {
  const h = header();
  assert.equal(byId(h, 'run-meta'), null, '#run-meta is still in the header');
  assert.equal(H.findAll(h, (e) => cls(e).includes('kpis') || cls(e).includes('kpi')).length, 0, 'the KPIs are still in the header');
  assert.doesNotMatch(H.visibleText(h), /Tokens in \/ out|Reasoning|All runs/);
});

test('#412 header: Open logs, Start, Stop and Pause are gone', () => {
  const h = header();
  const left = ['btn-open-dir', 'btn-quick-start', 'btn-stop', 'btn-pause'].filter((id) => byId(h, id));
  assert.deepEqual(left, []);
  const labels = H.findAll(h, (e) => e.name === 'button').map((e) => H.visibleText(e.inner).trim());
  for (const gone of ['Open logs', 'Start', 'Stop', 'Pause after current step']) {
    assert.equal(labels.includes(gone), false, `a "${gone}" button is still in the header`);
  }
});

test('#412 header: the 24/7 chip and the usage widget come right after the Project select, before the top right corner', () => {
  const h = header();
  const project = byId(h, 'header-project');
  const chip = byId(h, 'occupancy-chip');
  const usage = byId(h, 'usage-widget');
  const corner = H.findEl(h, (e) => cls(e).includes('header-right'));
  assert.ok(project && chip && usage && corner, 'the project select, the 24/7 chip, the usage widget and .header-right are in the header');
  assert.deepEqual([project.start < chip.start, chip.start < usage.start, usage.start < corner.start], [true, true, true]);
  // nothing a person uses between the project select and the chip (wrappers and comments only)
  const between = H.findAll(h, (e) => e.start > project.end && e.start < chip.start && ['button', 'select', 'input', 'a'].includes(e.name));
  assert.deepEqual(between.map((e) => e.attrs.id || e.name), []);
});

test('#412 header: the account is the last thing at the right end, after the notifications bell (and the Oracle button put before it)', () => {
  const h = header();
  const account = byId(h, 'account-wrap');
  const bell = H.findEl(h, (e) => cls(e).includes('notif-wrap'));
  assert.ok(account && bell, '#account-wrap and .notif-wrap are in the header');
  assert.equal(account.start > bell.end, true, 'the account comes after the bell');
  // no control of the header after the account's own
  const after = H.findAll(h, (e) => e.start >= account.end && ['button', 'select', 'input', 'a'].includes(e.name));
  assert.deepEqual(after.map((e) => e.attrs.id || e.name), []);
});

// guards behaviour that must not change
test('#412 header: the account stays hidden until someone signs in', () => {
  const account = byId(header(), 'account-wrap');
  assert.ok(account, '#account-wrap is in the header');
  assert.equal(cls(account).includes('hidden'), true);
});

test('#412 the page\'s scripts no longer reach for the removed header elements (no $(\'#run-meta\'), #kpi-…, #btn-open-dir, #btn-quick-start) unless some markup defines them', () => {
  const sources = pageScripts().map((src) => fs.readFileSync(path.join(RENDERER, ...src.split('/')), 'utf8'));
  const all = [html(), ...sources].join('\n');
  const stale = REMOVED_IDS.filter((id) => {
    const used = sources.some((s) => s.includes(`'#${id}'`) || s.includes(`"#${id}"`) || s.includes(`\`#${id}\``) || s.includes(`getElementById('${id}')`));
    const defined = all.includes(`id="${id}"`);
    return used && !defined;
  });
  assert.deepEqual(stale, []);
});
