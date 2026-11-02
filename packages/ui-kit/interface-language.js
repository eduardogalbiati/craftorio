/* global api */
// The interface language (#329): applies Settings › General › Language › Interface to the window and
// redraws it at once, without a restart (like the time zone's TimeZone.notify()). The catalog and
// t() are packages/shared/i18n.js; this file only holds the re-render wiring, out of app.js.
// window.InterfaceLanguage.apply(settings): resolves the language (settings.language.interface, else
// the computer's when it has a catalog, else English), remembers it for the next first paint
// (localStorage 'interfaceLanguage', read by i18n.js), paints index.html's static hooks
// (data-i18n = the text, data-i18n-title, data-i18n-aria-label, data-i18n-placeholder = catalog keys), and when the language
// changed: the menu's labels (view-registry.js relabelNav), the screens whose markup is a function
// (redrawMarkup), the shell (app.js render), then I18n.notify() for the rest (the Setup, the open
// project wizard, ...). #726: each of the first three runs on its own (an error is logged), so one
// that throws never stops the others nor I18n.notify().
// Every window follows the pushed 'settings:changed', so a change in one redraws the other too.
// Uses app.js globals (state, render).
(function () {
  let shown = null; // the language the window shows

  function paintStatic(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  }

  function apply(settings) {
    const lang = I18n.resolveLanguage(settings?.language?.interface, navigator.language);
    try { localStorage.setItem('interfaceLanguage', lang); } catch { /* no storage */ }
    const changed = lang !== I18n.getLanguage();
    I18n.setLanguage(lang);
    document.documentElement.lang = lang;
    if (lang === shown && !changed) return;
    shown = lang;
    paintStatic();
    if (!changed) return;
    // #726: each redraw on its own, so a screen that throws never keeps the others (the open wizard,
    // I18n.notify's listeners) in the old language
    redraw(() => window.ViewRegistry?.relabelNav());
    redraw(() => window.ViewRegistry?.redrawMarkup());
    redraw(() => { if (typeof render === 'function') render(); });
    I18n.notify();
  }

  function redraw(fn) {
    try { fn(); } catch (e) { console.error('interface language: a redraw failed', e); }
  }

  api.onSettingsChanged?.((settings) => {
    if (typeof state === 'object' && settings) state.settings = settings;
    apply(settings);
  });

  window.InterfaceLanguage = { apply, paintStatic };
})();
