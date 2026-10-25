// A test helper (not a test): reads and clicks what the real page (test/renderer-app-harness.js)
// rendered, for the tests of #354 (Projects back in the menu, a project's page with its tabs, the
// Conflict map tab). The harness's fake DOM keeps markup strings only, so:
// - region(app, testid): the markup inside every element carrying data-testid="<testid>" (in what was
//   written into an element, inserted, or a view's own markup), plus what was written into the
//   elements with an id found inside it (a static container filled later through `$('#id')`);
// - clickRendered(app, el): clicks a parsed element (roadmap-status-helpers' findEl) through a fake
//   target carrying its attributes, its own `#id` element when it has one, then the elements holding
//   its markup and the open screen's section (delegated listeners), then the document;
// - tabsOf(markup): the role="tab" elements, with their label and aria-selected.
// Exports functions only (never registers a test).
const H = require('./roadmap-status-helpers');

/** Every markup string the page holds now: what was written into an element or inserted, then the views' own markup. */
function pageMarkup(app, { defs = true } = {}) {
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''));
    for (const [, html] of el.inserted || []) parts.push(String(html || ''));
  }
  if (defs) for (const def of app.defs.values()) parts.push(String(def.markup || ''), String(def.modals || ''));
  return parts.join('\n');
}

/** The fake element of `#id` when the page made or asked for one, else null (never creates it). */
function existing(app, id) {
  return app.created.find((e) => e.id === id) || app.elements.get(`#${id}`) || null;
}

/** The markup of the element(s) with data-testid="<testid>", with what was written into the ids inside them. */
function region(app, testid) {
  const parts = [];
  const seen = new Set();
  const follow = (html, depth) => {
    parts.push(html);
    if (depth > 3) return;
    for (const m of String(html).matchAll(/\bid="([\w-]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const el = existing(app, m[1]);
      if (el && el.innerHTML) follow(String(el.innerHTML), depth + 1);
    }
  };
  const direct = app.elements.get(`[data-testid="${testid}"]`);
  if (direct?.innerHTML) follow(String(direct.innerHTML), 0);
  for (const el of H.findAll(pageMarkup(app), (e) => e.attrs['data-testid'] === testid)) follow(el.inner, 0);
  return parts.join('\n');
}

/** True when an element with data-testid="<testid>" is in the page's markup. */
const hasTestId = (app, testid, opts) => !!H.findEl(pageMarkup(app, opts), (e) => e.attrs['data-testid'] === testid);

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
let clicks = 0;

/** Clicks a parsed element of the page's markup (see the header). */
async function clickRendered(app, el, within = []) {
  const sel = el.attrs.id ? `#${el.attrs.id}` : `[data-test-click-${(clicks += 1)}]`;
  const target = app.el(sel);
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k.startsWith('data-')) target.dataset[camel(k.slice(5))] = v;
    else if (k === 'class') target.className = v;
    else if (k !== 'id') target.attrs[k] = v;
  }
  target.tagName = el.name.toUpperCase();
  target.textContent = H.visibleText(el.inner);
  const holders = [];
  for (const [key, fake] of app.elements) {
    if (key === sel) continue;
    const inside = String(fake.innerHTML || '').includes(el.outer) || (fake.inserted || []).some(([, html]) => String(html).includes(el.outer));
    if (inside) holders.push(key);
  }
  const def = app.defs.get(app.state().view);
  const section = `#view-${def?.section || app.state().view}`;
  await app.click(sel, { within: [...holders, ...within, section] });
  await app.settle(10);
}

/** The role="tab" elements of some markup: [{ label, selected, el }]. */
function tabsOf(markup) {
  return H.findAll(markup, (e) => e.attrs.role === 'tab').map((el) => ({ label: H.visibleText(el.inner), selected: el.attrs['aria-selected'] === 'true', el }));
}

module.exports = { clickRendered, existing, hasTestId, pageMarkup, region, tabsOf };
