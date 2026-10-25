// The view registry: a screen in `apps/desktop/renderer/views/<view>/` registers itself, so adding one only
// adds files (its folder; `npm run docs` lists its <script>/<link> lines in index.html).
// load: early (registerView exists before app.js and the views)
//   registerView({ id, nav: { label, icon, order, title, group, tab }, section, menu, markup, modals, mount, show })
// `markup` is the screen's whole `<section id="view-<id>" class="view hidden">`, added to the content
// container; `modals` its own dialogs, added to the body; `nav` an entry of the sidebar's menu
// (`.sidebar-menu`, #411), placed before the first entry with a higher `data-order`, else at the menu's end,
// or a list of entries (the Workflows tabs: each opens the screen on its `tab`). An entry's `group`
// (#254, nav-groups.js: plan, code, workflows, ai) puts it under that group's title, which folds.
// `section`: the screen is drawn in another screen's section (the Roadmap, in the Backlog's);
// `menu`: the entry lit on a screen that has none (a project's page lights Settings).
// `panel` (#255): the markup of a screen that is a tab of another one (Analytics, in Home), instead
// of `markup`: that screen places it in its own section, or draws an empty `#view-<id>` placeholder
// when the panel's screen registers later (a front's screen loads after the shell's, phase 3), which
// the panel then takes the place of.
// `mount()` runs once, right after the markup is in place; `show()` each time showView opens it.
// #329 the interface language: `markup` may be a function (drawn again when the language changes,
// redrawMarkup); the menu's texts come from the catalog (packages/shared/i18n.js) by key, `nav.<id>`
// (`nav.<id>.<tab>` for a tab, `nav.<id>.title` for the hover text, `nav.group.<id>` for a group's
// title), else the entry's own text, so the views keep their English `nav`; relabelNav repaints them.
const viewRegistry = new Map();
const navGroupBoxes = new Map(); // a group's id → the element that holds its entries

// The catalog's text of a key, else `fallback` (a view without a catalog entry keeps its English).
function navText(key, fallback) {
  const text = window.I18n?.t(key);
  return text && text !== key ? text : fallback;
}
const navKey = (id, entry) => (entry.tab ? `nav.${id}.${entry.tab}` : `nav.${id}`);
const markupOf = (markup) => (typeof markup === 'function' ? markup() : markup);

// The first entry of `box` itself with a higher order (a group's entries belong to the group).
const navNext = (box, order) => [...box.querySelectorAll('[data-order]')]
  .find((el) => (el.parentNode || box) === box && Number(el.dataset.order) > order);

// A group's box, created with its title on the group's first entry; the title folds it (remembered).
function navGroupBox(menu, group) {
  if (navGroupBoxes.has(group.id)) return navGroupBoxes.get(group.id);
  const el = document.createElement('div');
  el.className = 'nav-group';
  el.dataset.group = group.id;
  el.dataset.order = String(group.order);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', navText(`nav.group.${group.id}`, group.title));
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'nav-group-title';
  title.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>';
  const label = document.createElement('span');
  label.textContent = navText(`nav.group.${group.id}`, group.title);
  title.append(label);
  const box = document.createElement('div');
  box.className = 'nav-group-items';
  const paint = () => {
    const collapsed = window.NavGroups.isCollapsed(group.id, localStorage);
    el.classList.toggle('collapsed', collapsed);
    box.classList.toggle('hidden', collapsed);
    title.setAttribute('aria-expanded', String(!collapsed));
  };
  title.onclick = () => {
    window.NavGroups.setCollapsed(group.id, !window.NavGroups.isCollapsed(group.id, localStorage), localStorage);
    paint();
  };
  paint();
  el.append(title, box);
  menu.insertBefore(el, navNext(menu, group.order) || null);
  navGroupBoxes.set(group.id, box);
  return box;
}

// #330 a language change repaints a drawn markup in place (redrawMarkup): each text node and labelled
// attribute that still shows the previous language's text takes the new one, matched node by node with
// the markup drawn before. What the screen drew since (its lists, states, chats, terminals) stays and
// its show() draws it again, so mount() runs once. A markup whose structure changed, or a page without
// a DOM walker (the tests' stub), draws the screen again and mounts it again. A mount that adds markup
// elsewhere (a drawer in the shell, a dock in another screen) draws it with ViewRegistry.draw(container,
// () => html) to be repainted too.
const LABELLED = ['title', 'placeholder', 'aria-label', 'alt'];
const drawnMarkups = []; // { source, def (a view's own markup), html, nodes: the live nodes in document order }

// the nodes and their element and text descendants, in document order
function nodesOf(tops) {
  const out = [];
  for (const top of tops) {
    out.push(top);
    const walker = document.createTreeWalker(top, 5); // NodeFilter.SHOW_ELEMENT | SHOW_TEXT
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  }
  return out;
}

function parsedNodes(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return nodesOf([...tpl.content.childNodes]);
}

/** Puts the new texts on the live nodes still showing the old ones; false when the structure differs. */
function repaintNodes(live, before, after) {
  if (live.length !== after.length || before.length !== after.length) return false;
  if (after.some((n, i) => n.nodeName !== before[i].nodeName || n.nodeName !== live[i].nodeName)) return false;
  after.forEach((n, i) => {
    const el = live[i];
    if (!el.isConnected) return;
    if (n.nodeType === 3) {
      if (el.nodeValue === before[i].nodeValue) el.nodeValue = n.nodeValue;
      return;
    }
    if (n.nodeType !== 1) return; // a comment drawn at a markup's top level: nothing to repaint
    for (const name of LABELLED) {
      const was = before[i].getAttribute(name);
      const now = n.getAttribute(name);
      if (now != null && now !== was && el.getAttribute(name) === was) el.setAttribute(name, now);
    }
  });
  return true;
}

// draws a markup (a string, or a function drawn again in a new language) at the end of container,
// remembering its nodes for a repaint; `def` when it is that view's own markup
function drawInto(container, source, def) {
  const html = markupOf(source);
  const last = container.lastChild;
  container.insertAdjacentHTML('beforeend', html);
  if (typeof document.createTreeWalker !== 'function') return;
  const tops = [];
  for (let n = last ? last.nextSibling : container.firstChild; n; n = n.nextSibling) tops.push(n);
  drawnMarkups.push({ source, def, html, nodes: nodesOf(tops) });
}

function registerView(def) {
  const { id, nav, markup, modals, panel, section } = def;
  if (markup) drawInto(document.querySelector('main.content'), markup, def);
  if (modals) drawInto(document.body, modals);
  // #255 a panel of another screen's section (Analytics in Home) registered after that screen drew
  // its placeholder `#view-<id>` (phase 3: a front's screen loads after the shell's): the panel
  // takes the placeholder's place, so the order the layers load in does not matter
  if (panel && section) {
    const placeholder = document.getElementById?.(`view-${id}`);
    if (placeholder && !placeholder.children?.length && typeof placeholder.insertAdjacentHTML === 'function') {
      placeholder.insertAdjacentHTML('afterend', markupOf(panel));
      placeholder.remove();
    }
  }
  for (const entry of [].concat(nav || [])) {
    const menu = document.querySelector('nav.sidebar .sidebar-menu'); // #411 the sidebar's scrolling part
    const group = entry.group && window.NavGroups.GROUPS.find((g) => g.id === entry.group);
    const box = group ? navGroupBox(menu, group) : menu;
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = id;
    if (entry.tab) btn.dataset.tab = entry.tab;
    btn.dataset.order = String(entry.order);
    if (entry.title) btn.title = navText(`${navKey(id, entry)}.title`, entry.title);
    btn.innerHTML = `${entry.icon || ''}<span>${navText(navKey(id, entry), entry.label)}</span>`;
    btn._navEntry = entry;
    box.insertBefore(btn, navNext(box, entry.order) || null);
  }
  viewRegistry.set(id, def);
  def.mount?.();
}
window.registerView = registerView;

/** Repaints the menu's texts in the current interface language (#329). */
function relabelNav() {
  for (const btn of document.querySelectorAll('.nav-item[data-view]')) {
    const entry = btn._navEntry;
    if (!entry) continue;
    if (entry.title) btn.title = navText(`${navKey(btn.dataset.view, entry)}.title`, entry.title);
    const span = btn.querySelector(':scope > span');
    if (span) span.innerHTML = navText(navKey(btn.dataset.view, entry), entry.label);
  }
  for (const group of window.NavGroups.GROUPS) {
    const el = document.querySelector(`.nav-group[data-group="${group.id}"]`);
    if (!el) continue;
    const text = navText(`nav.group.${group.id}`, group.title);
    el.setAttribute('aria-label', text);
    const span = el.querySelector('.nav-group-title > span');
    if (span) span.textContent = text;
  }
}

/**
 * Puts the screens whose markup or modals are functions in the new language (#329, #330): repainted in
 * place, else (structure changed, no DOM walker) the markup drawn again and mounted again; the screen
 * showing is shown again.
 */
function redrawMarkup() {
  const repainted = new Set();
  for (const drawn of drawnMarkups) {
    if (typeof drawn.source !== 'function') continue;
    const html = drawn.source();
    if (!repaintNodes(drawn.nodes, parsedNodes(drawn.html), parsedNodes(html))) continue;
    drawn.html = html;
    if (drawn.def) repainted.add(drawn.def);
  }
  for (const [id, def] of viewRegistry) {
    if (typeof def.markup !== 'function') continue;
    const old = document.getElementById(`view-${id}`);
    if (!old) continue;
    const hidden = old.classList.contains('hidden');
    if (!repainted.has(def)) {
      const html = def.markup();
      old.insertAdjacentHTML('afterend', html);
      old.remove();
      const drawn = drawnMarkups.find((d) => d.def === def);
      const now = document.getElementById(`view-${id}`);
      if (drawn && now) Object.assign(drawn, { html, nodes: nodesOf([now]) });
      now?.classList.toggle('hidden', hidden);
      def.mount?.();
    }
    if (!hidden) def.show?.();
  }
}
window.ViewRegistry = {
  draw: (container, source) => drawInto(container, source),
  // the registered screens' ids (the smoke checks every screen of the composition registered, scripts/smoke.js)
  has: (id) => viewRegistry.has(id),
  ids: () => [...viewRegistry.keys()],
  redrawMarkup,
  relabelNav,
  repaintNodes,
};
