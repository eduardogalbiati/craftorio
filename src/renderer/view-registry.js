// The view registry: a screen in `src/renderer/views/<view>/` registers itself, so adding one only
// adds files (its folder, plus its <script>/<link> lines in index.html). Loaded before app.js.
//   registerView({ id, nav: { label, icon, order, title }, markup, modals, mount, show })
// `markup` is the screen's whole `<section id="view-<id>" class="view hidden">`, added to the content
// container; `modals` its own dialogs, added to the body; `nav` a sidebar entry, placed before the
// first entry with a higher `data-order` (static entries carry one too, until they move to a folder).
// `mount()` runs once, right after the markup is in place; `show()` each time showView opens it.
const viewRegistry = new Map();

function registerView(def) {
  const { id, nav, markup, modals } = def;
  if (markup) document.querySelector('main.content').insertAdjacentHTML('beforeend', markup);
  if (modals) document.body.insertAdjacentHTML('beforeend', modals);
  if (nav) {
    const sidebar = document.querySelector('nav.sidebar');
    const next = [...sidebar.querySelectorAll('[data-order]')].find((el) => Number(el.dataset.order) > nav.order)
      || sidebar.querySelector('.nav-spacer');
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.view = id;
    btn.dataset.order = String(nav.order);
    if (nav.title) btn.title = nav.title;
    btn.innerHTML = `${nav.icon || ''}<span>${nav.label}</span>`;
    sidebar.insertBefore(btn, next);
  }
  viewRegistry.set(id, def);
  def.mount?.();
}
window.registerView = registerView;
