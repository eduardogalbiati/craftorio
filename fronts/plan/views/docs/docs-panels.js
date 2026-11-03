// Documents screen (#671, views/docs/docs.js): the markup of the panels the spec's mockups draw
// (docs/work/write-doc/images/): the New item side panel (mock-1), the editor's toolbar (mock-2), the review with its rubric checks
// and anchored notes (mock-4) and the sign-off gate (mock-5). Markup only, from the values docs.js
// passes, and the New item panel's Several writers value (#648); the clicks are docs.js's (data-docs-*). Uses app.js globals (esc, t) and Select (select.js). Browser: window.DocsPanels.
(() => {
  // #648 Several writers: how many may draft (write-doc's `writers`, 2 to 5), three unless chosen
  const WRITER_COUNTS = ['2', '3', '4', '5'];
  const SEVERAL_WRITERS = '3';
  // the side panel next to the list: starts with, what it is about, the screens (a later phase,
  // disabled), Several writers (#648: write-doc's Arena mode), the estimate and Start; `steps` the SDLC steps a document starts at
  function newItemPanel(steps, estimate) {
    return `
          <aside id="docs-new-panel" class="docs-new-panel hidden" data-testid="docs-new-panel" aria-labelledby="docs-new-heading">
            <form id="docs-new-form" class="docs-new-form">
              <div class="docs-new-head">
                <h2 id="docs-new-heading">${t('docs.new_item')}</h2>
                <button type="button" id="btn-docs-new-close" class="docs-chip-x" aria-label="${t('common.close')}" title="${t('common.close')}">×</button>
              </div>
              <div class="field">
                <label for="docs-new-starts">${t('docs.starts_with')}</label>
                ${Select.markup('id="docs-new-starts" data-testid="docs-new-starts-with"', steps.map((s) => [s.doc, `${s.file} (${s.name()})`]))}
              </div>
              <div class="field">
                <label for="docs-new-title">${t('docs.what_it_is_about')}</label>
                <textarea id="docs-new-title" data-testid="docs-new-item-title" rows="3" maxlength="200" placeholder="${t('docs.what_the_item_is_about')}"></textarea>
              </div>
              <div class="field">
                <span class="docs-new-label">${t('docs.screens_to_capture_first')}</span>
                <div class="docs-new-screens" data-testid="docs-new-screens">
                  <button type="button" class="chip" data-testid="docs-new-screen-add" disabled title="${t('docs.later_phase')}">${t('docs.add_screen')}</button>
                </div>
              </div>
              <label class="docs-new-writers">
                <input type="checkbox" data-testid="docs-new-writers" />
                <span><b>${t('docs.several_writers')}</b><span class="muted small">${t('docs.several_writers_help')}</span></span>
              </label>
              <div class="field docs-new-writers-count hidden" data-docs-writers-count>
                <label for="docs-new-writers-count">${t('docs.how_many_writers')}</label>
                ${Select.markup('id="docs-new-writers-count" data-testid="docs-new-writers-count"', WRITER_COUNTS.map((n) => [n, n]), SEVERAL_WRITERS)}
              </div>
              <p id="docs-new-error" class="error small"></p>
              <div class="docs-new-foot">
                <span id="docs-new-estimate" class="mono muted small" data-testid="docs-new-estimate">${estimate}</span>
                <span class="spacer"></span>
                <button type="submit" class="btn primary" data-testid="docs-new-item-start">${t('docs.start')}</button>
              </div>
            </form>
          </aside>`;
  }

  // the reviewer's score, its rubric checks and its notes (`key` the anchor a note shows), each with
  // Apply / Edit / Dismiss; '' before the review. A note applied at the approval gate stays, queued,
  // until the writer has answered it; Apply is off without a run to send it to (`canApply`)
  function review({ score, checks, notes, key, canApply = true }) {
    if (!notes.length && !checks.length && score === undefined) return '';
    const result = (r) => {
      if (r === 'pass') return `<span class="docs-pill done">${t('docs.check_pass')}</span>`;
      if (r === 'note') return `<span class="docs-pill editing">${t('docs.check_note')}</span>`;
      return `<span class="docs-pill">${esc(r || '')}</span>`;
    };
    return `
      <div class="docs-section-head"><h3>${t('docs.review')}</h3>${score !== undefined ? `<span class="docs-pill done" data-testid="doc-review-score">${t('docs.review_score', { score: esc(score) })}</span>` : ''}</div>
      ${checks.length ? `<ul class="docs-check-list">${checks.map((c) => `
        <li class="docs-check" data-testid="doc-review-check"><span class="docs-check-name" title="${esc(c.name)}">${esc(c.name)}</span>${result(c.result)}</li>`).join('')}</ul>` : ''}
      <ul class="docs-note-list">${notes.map((n, i) => `
        <li class="docs-note${n.severity === 'major' ? ' major' : ''}" data-testid="doc-review-note" data-anchor="${esc(n.anchor)}">
          <div class="docs-note-top"><b class="mono">#${esc(key(n.anchor))}</b><span class="muted small">${t('docs.reviewer')}</span>${n.queued ? `<span class="docs-pill editing" data-testid="doc-note-queued">${t('docs.note_queued')}</span>` : ''}</div>
          ${n.quote ? `<blockquote class="docs-note-quote">“${esc(n.quote)}”</blockquote>` : ''}
          <p class="docs-note-text">${esc(n.text)}</p>
          <div class="row docs-note-actions">
            <button type="button" class="btn sm primary" data-testid="doc-note-apply" data-docs-note-apply="${i}"${canApply && !n.queued ? '' : ' disabled'}>${t('docs.apply')}</button>
            <button type="button" class="btn sm ghost" data-testid="doc-note-edit" data-docs-note-edit="${i}">${t('docs.edit')}</button>
            <button type="button" class="btn sm ghost" data-testid="doc-note-dismiss" data-docs-note-dismiss="${i}">${t('docs.dismiss')}</button>
          </div>
        </li>`).join('')}</ul>`; // i18n-ignore
  }

  // the sign-off panel: the review and unreviewed pills, the front matter the gate writes (`from` →
  // `to`), the next steps (nothing starts before their own click) and its three answers
  // the gate's words per document (intent, spec, #633 plan): its answer and the next steps
  const GATE = {
    intent: { accept: () => t('docs.accept_intent'), next: () => [[t('docs.write_the_spec'), t('docs.next_spec_help')]] },
    spec: {
      accept: () => t('docs.sign_off_spec'),
      next: () => [[t('docs.create_epic_and_phase_issues'), t('docs.next_issues_help')], [t('docs.start_the_build'), t('docs.next_build_help')]],
    },
    plan: { accept: () => t('docs.accept_plan'), next: () => [[t('docs.create_epic_and_phase_issues'), t('docs.next_plan_issues_help')], [t('docs.start_the_build'), t('docs.next_plan_build_help')]] },
  };

  function signoff({ doc, file, from, to, score, open, pending, message, versions, wait }) {
    const today = new Date().toISOString().slice(0, 10);
    const spec = doc === 'spec';
    const gate = GATE[doc] || GATE.intent;
    // the front matter's own keys, as the file spells them
    const fm = `status: ${esc(from || 'draft')} → <span class="docs-fm-new">${esc(to || '')}</span> · approver: ${t('docs.your_git_name')} · date: ${today}`; // i18n-ignore
    const next = gate.next();
    return `
      <section class="docs-signoff" data-testid="doc-signoff" aria-labelledby="docs-signoff-heading">
        <div class="docs-signoff-head">
          <h3 id="docs-signoff-heading">${spec ? t('docs.sign_off_required', { file }) : t('docs.acceptance_required', { file })}</h3>
          <span class="spacer"></span>
          ${score !== undefined ? `<span class="docs-pill done" data-testid="doc-signoff-review">${open === 1 ? t('docs.review_pill_one', { score: esc(score), count: open }) : t('docs.review_pill', { score: esc(score), count: open })}</span>` : ''}
          <span class="docs-pill${pending ? ' editing' : ' done'}" data-testid="doc-signoff-unreviewed">${pending === 1 ? t('docs.unreviewed_changes_one', { count: pending }) : t('docs.unreviewed_changes', { count: pending })}</span>
        </div>
        ${message ? `<p class="muted small docs-gate-message" title="${esc(message)}">${esc(message)}</p>` : ''}
        <div class="docs-signoff-fm">
          <b class="small">${spec ? t('docs.front_matter_after_sign_off') : t('docs.front_matter_after_acceptance')}</b>
          <code class="docs-signoff-fm-line" data-testid="doc-signoff-frontmatter">${fm}</code>
        </div>
        <div class="docs-signoff-next">${next.map(([title, help]) => `
          <div class="docs-next-card" data-testid="doc-signoff-next"><b>${title}</b><p class="muted small">${help}</p></div>`).join('')}</div>
        <div class="row docs-signoff-actions">
          <button type="button" class="btn primary" data-testid="doc-gate-accept" data-docs-gate="accept"${wait}>${gate.accept()}</button>
          <button type="button" class="btn ghost" data-testid="doc-gate-revise" data-docs-gate="revise"${wait}>${t('docs.back_to_editing')}</button>
          <button type="button" class="btn ghost" data-testid="doc-gate-cancel" data-docs-stop${wait}>${t('docs.stop')}</button>
          <span class="spacer"></span>
          <span class="muted small mono">${t('docs.versions_count', { count: versions })}</span>
        </div>
      </section>`; // i18n-ignore
  }

  // the editor's toolbar (mock-2): the view tabs, the language, then Versions and Send to review at its
  // right (#696); `wait` disables Send to review
  function toolbar({ tab: current, lang: language, translation, wait }) {
    const tab = (id, label) => `<button type="button" role="tab" class="${current === id ? 'active' : ''}" aria-selected="${current === id}" data-docs-tab="${id}">${label}</button>`;
    const lang = (id, label, off) => `<button type="button" class="${language === id ? 'active' : ''}" aria-pressed="${language === id}" data-testid="doc-lang-${id}" data-docs-lang="${id}"${off ? ' disabled' : ''}>${label}</button>`;
    return `
      <div class="docs-toolbar" data-testid="doc-toolbar">
        <div class="seg sm" role="tablist" aria-label="${t('docs.view')}">${tab('edit', t('docs.edit'))}${tab('diff', t('docs.diff'))}${tab('preview', t('docs.preview'))}</div>
        <div class="seg sm" role="group" aria-label="${t('docs.language')}">${lang('en', 'EN', false)}${lang('pt', 'PT', !translation)}</div>
        <div class="docs-toolbar-end">
          <button type="button" class="btn sm ghost" data-testid="doc-versions" data-docs-tab="diff" title="${t('docs.versions_help')}">${t('docs.versions')}</button>
          <button type="button" class="btn sm primary" data-testid="doc-send-to-review" data-docs-gate="send_to_review"${wait ? ' disabled' : ''}>${t('docs.send_to_review')}</button>
        </div>
      </div>`; // i18n-ignore
  }

  // the list's button that opens each document (#633: plan.md, written from the signed-off spec)
  const OPEN_LABEL = { intent: 'docs.open_intent', spec: 'docs.open_spec', plan: 'docs.open_plan' };
  const openLabel = (doc) => t(OPEN_LABEL[doc] || OPEN_LABEL.intent);

  // #648: the New item panel's "Several writers" (write-doc's Arena mode): the `writers` input it asks
  // for (write-doc's text enum "1"-"5": the count chosen, 2 to 5, shown while the box is on), null when
  // off (the workflow's one writer); `on` sets the box first (off: the count back to its default)
  function newItemWriters(on) {
    const box = document.querySelector('#docs-new-panel [data-testid="docs-new-writers"]');
    const count = document.querySelector('#docs-new-writers-count');
    if (box && typeof on === 'boolean') {
      box.checked = on;
      if (!on && count) count.value = SEVERAL_WRITERS;
    }
    document.querySelector('#docs-new-panel [data-docs-writers-count]')?.classList.toggle('hidden', !box?.checked);
    if (!box?.checked) return null;
    return WRITER_COUNTS.includes(count?.value) ? count.value : SEVERAL_WRITERS;
  }
  // the count shows as soon as the box is turned on
  document.addEventListener('change', (e) => { if (e.target?.matches?.('#docs-new-panel [data-testid="docs-new-writers"]')) newItemWriters(); });

  window.DocsPanels = {
    newItemPanel,
    newItemWriters,
    openLabel,
    review,
    signoff,
    toolbar,
  };
})();
