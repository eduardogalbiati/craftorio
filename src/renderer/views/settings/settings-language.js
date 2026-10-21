/* global api */
// Settings › General › Language (#327, #328, #329): the "Interface" select (the languages with a
// catalog, I18n.languages(); unset, the language the page runs in: the computer's when it has a
// catalog, else English), the "AI agents" select (chat replies, the prose of step outputs, handoff
// notes, decision logs, documents; "Same as the interface" by default, named with the language the
// interface resolves to, "Same as the interface (Português (Brasil))", #424) and the "Issues" select
// (issues, comments, PR/MR descriptions, commit messages; English by default). The languages come
// from src/shared/language.js; a change saves the values as settings.language, every agent's next
// turn reads it ([Language] line), and an Interface change redraws the open windows at once
// (interface-language.js).
// window.LanguageSettings = { markup(settings), patch(settings, kind, value), render(el) }: settings.js
// draws it into #set-language; uses app.js globals (esc, state) and window.I18n (t).
(() => {
  const languages = () => window.Language.LANGUAGES.map((l) => [l.code, l.label]);
  const interfaceLanguages = () => window.I18n.languages().map((code) => [code, window.Language.labelOf(code)]);
  const saved = (settings) => ({
    agents: settings?.language?.agents || window.Language.SAME_AS_INTERFACE,
    issues: settings?.language?.issues || 'en',
    // only once chosen: unset, the interface follows the computer's language
    ...(settings?.language?.interface && { interface: settings.language.interface }),
  });

  function row({ kind, label, help, options, value }) {
    const helpId = `set-language-${kind}-help`;
    return `<div class="s-row">
        <div class="s-label"><b>${esc(label)}</b><span id="${helpId}">${esc(help)}</span></div>
        <div class="s-ctrl">${window.Select.markup(`aria-label="${esc(label)}" aria-describedby="${helpId}" data-testid="settings-language-${kind}" data-language="${kind}"`, options, value)}</div>
      </div>`;
  }

  /** The group's markup, the saved languages selected. */
  function markup(settings) {
    const v = saved(settings);
    return `<div data-testid="settings-language">
        <h3 class="s-subtitle">${t('settings.language.title')}</h3>
        <div class="s-group">
          ${row({
            kind: 'interface',
            label: t('settings.language.interface'),
            help: t('settings.language.interface_help'),
            options: interfaceLanguages(),
            value: v.interface || window.I18n.getLanguage(),
          })}
          ${row({
            kind: 'agents',
            label: t('settings.language.agents'),
            help: t('settings.language.agents_help'),
            options: [[window.Language.SAME_AS_INTERFACE, t('settings.language.same_as_interface_named', { language: window.Language.labelOf(v.interface || window.I18n.getLanguage()) })], ...languages()],
            value: v.agents,
          })}
          ${row({
            kind: 'issues',
            label: t('settings.language.issues'),
            help: t('settings.language.issues_help'),
            options: languages(),
            value: v.issues,
          })}
        </div>
      </div>`;
  }

  /** What a change of one select saves: the values together. */
  function patch(settings, kind, value) {
    return { language: { ...saved(settings), [kind]: value } };
  }

  // the element the group was last drawn into: redrawn in the new language when the interface
  // language changes (I18n.onChange), its labels and the "Same as the interface (…)" name with it
  let drawnIn = null;
  window.I18n?.onChange?.(() => { if (drawnIn?.isConnected) render(drawnIn); });

  /** Draws the group into el and saves a change at once (a single choice, like Time zone). */
  function render(el) {
    if (!el) return;
    drawnIn = el;    el.innerHTML = markup(state.settings);
    el.onchange = async (e) => {
      const kind = e.target.dataset?.language;      if (!kind) return;
      state.settings = await api.setSettings(patch(state.settings, kind, e.target.value));
      if (kind === 'interface') window.InterfaceLanguage?.apply(state.settings);
    };
  }

  window.LanguageSettings = { markup, patch, render };
})();
