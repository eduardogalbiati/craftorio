/* global api */
// Settings › General › Language (#327, #328): the "AI agents" select (chat replies, the prose of step
// outputs, handoff notes, decision logs, documents; "Same as the interface" by default, English until
// the interface has a language, #329) and the "Issues" select (issues, comments, PR/MR descriptions,
// commit messages; English by default). The languages come from src/shared/language.js; a change
// saves both values as settings.language, and every agent's next turn reads it ([Language] line).
// window.LanguageSettings = { markup(settings), patch(settings, kind, value), render(el) }: settings.js
// draws it into #set-language; uses app.js globals (esc, state).
(() => {
  const languages = () => window.Language.LANGUAGES.map((l) => [l.code, l.label]);
  const saved = (settings) => ({
    agents: settings?.language?.agents || window.Language.SAME_AS_INTERFACE,
    issues: settings?.language?.issues || 'en',
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
        <h3 class="s-subtitle">Language</h3>
        <div class="s-group">
          ${row({
            kind: 'agents',
            label: 'AI agents',
            help: 'Chat replies, the prose of step outputs, handoff notes, decision logs and documents. Same as the interface: English for now. JSON keys, paths, branches and code comments stay as they are.',
            options: [[window.Language.SAME_AS_INTERFACE, 'Same as the interface'], ...languages()],
            value: v.agents,
          })}
          ${row({
            kind: 'issues',
            label: 'Issues',
            help: 'Issues, issue comments, PR/MR descriptions and commit messages: what goes to the repository. Checkboxes, #n references, labels and closing keywords (Closes #n) stay as they are.',
            options: languages(),
            value: v.issues,
          })}
        </div>
      </div>`;
  }

  /** What a change of one select saves: both values together. */
  function patch(settings, kind, value) {
    return { language: { ...saved(settings), [kind]: value } };
  }

  /** Draws the group into el and saves a change at once (a single choice, like Time zone). */
  function render(el) {
    if (!el) return;
    el.innerHTML = markup(state.settings);
    el.onchange = async (e) => {
      const kind = e.target.dataset?.language;
      if (!kind) return;
      state.settings = await api.setSettings(patch(state.settings, kind, e.target.value));
    };
  }

  window.LanguageSettings = { markup, patch, render };
})();
