// The view registry: a screen in `src/renderer/views/<view>/` registers itself, so adding one only
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
// of `markup`: that screen places it in its own section.
// `mount()` runs once, right after the markup is in place; `show()` each time showView opens it.
const viewRegistry = new Map();
const navGroupBoxes = new Map(); // a group's id → the element that holds its entries

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
  el.setAttribute('aria-label', group.title);
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'nav-group-title';
  title.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>';
  const label = document.createElement('span');
  label.textContent = group.title;
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

function registerView(def) {
  const { id, nav, markup, modals } = def;
  if (markup) document.querySelector('main.content').insertAdjacentHTML('beforeend', markup);
  if (modals) document.body.insertAdjacentHTML('beforeend', modals);
  for (const entry of [].concat(nav || [])) {
    const menu = document.querySelector('nav.sidebar .sidebar-menu'); // #411 the sidebar's scrolling part
    const group = entry.group && window.NavGroups.GROUPS.find((g) => g.id === entry.group);
    const box = group ? navGroupBox(menu, group) : menu;
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = id;
    if (entry.tab) btn.dataset.tab = entry.tab;
    btn.dataset.order = String(entry.order);
    if (entry.title) btn.title = entry.title;
    btn.innerHTML = `${entry.icon || ''}<span>${entry.label}</span>`;
    box.insertBefore(btn, navNext(box, entry.order) || null);
  }
  viewRegistry.set(id, def);
  def.mount?.();
}
window.registerView = registerView;
