/* global api */
// Discovery › the commitment point (#258, packages/engine/domains/discovery/discovery-commit.js), drawn for the Discovery board
// (views/discovery/discovery.js) as window.DiscoveryCommit:
// - a Ready card's panel offers "Commit to the backlog" (actionHtml): enabled from 85% clarity,
//   disabled under it with why (the panel's Clarity section lists the gaps and offers Grill me);
// - the commit dialog (open): the Product Owner's proposed split, one framed row per issue in the
//   look of the Backlog's split proposals (its title, complexity, workflow and tasks, one per line,
//   all editable; "merge with issue n" joins two), "Plan them in the roadmap, in this order", then
//   File the issues / Cancel (Esc; neither while the issues are being filed). Nothing is filed
//   before File the issues. In developer mode on a workspace that can run for real, the proposal
//   is the rule-based one and File the issues only previews the commands (as the Product Owner's
//   own writes do): nothing is filed, the card stays in Ready. #836: opened from a mockup (Prepare
//   issues in the mockup editor) with `crops` ([{ mid, file, name }]), it draws each cropped region
//   (discovery-commit-crop, data-mid, its image on mockup://) and File the issues sends them with
//   every issue (packages/engine/domains/discovery/discovery-commit.js lists them in the body);
// - the Committed list beside the board (committedHtml): each committed card with its delivery
//   (deliveryHtml: the stage In delivery / Delivered / Released, the counts to do, running, merged
//   locally, done, and each issue with its status, all drawn by StatusPill). A committed card has no
//   "Move to…": it never returns to the board.
// Uses app.js globals ($, esc, state, errMsg, openModal, closeModal), StatusPill and DefaultWorkflow.
(() => {
  const BAR = 85; // the commit bar (packages/engine/domains/discovery/discovery-commit.js COMMIT_BAR)
  const COUNTS = [['todo', 'to do'], ['running', 'running'], ['local', 'merged locally'], ['done', 'done']];
  const MAX_ISSUES = 8;

  // cm: the dialog's card and project, the split being edited, what the proposal said about itself
  // preview: developer mode on a workspace that can run for real (nothing is filed or committed)
  const cm = { projectId: null, card: null, issues: [], crops: [], loading: false, busy: false, note: '', seq: 0, done: null, preview: false };
  const pill = (status, title) => window.StatusPill.statusPill(status, { title });

  const scoreOf = (c) => (typeof c?.clarity?.score === 'number' ? c.clarity.score : null);
  /** Whether a Ready card is under the commit bar (never scored counts as under). */
  const underBar = (c) => !(scoreOf(c) !== null && scoreOf(c) >= BAR);

  // ---- the card's panel ---------------------------------------------------------------------------
  /** The Ready card's action: Commit to the backlog, disabled under the commit bar with why. */
  function actionHtml(c) {
    const score = scoreOf(c);
    const under = underBar(c);
    const why = score === null ? `A card is committed from ${BAR}% clarity: this one has no score yet.`
      : `A card is committed from ${BAR}% clarity: this one is at ${score}%. Close the gaps listed under Clarity (Grill me).`;
    return `
      <div class="row dsc-actions" role="group" aria-label="${t('discovery_commit.ready')}">
        <button type="button" class="btn sm primary" data-testid="discovery-commit" data-detail="commit"${under ? ' disabled' : ''} title="${esc(under ? why : t('discovery_commit.the_product_owner_proposes_the_issues'))}">${t('discovery_commit.commit_to_the_backlog')}</button>
      </div>
      <p class="muted small dsc-actions-hint" data-testid="discovery-commit-hint">${esc(under ? why : t('discovery_commit.the_card_becomes_one_or_more'))}</p>`;
  }

  // ---- delivery -----------------------------------------------------------------------------------
  // the stage as a status pill; a released card names its release next to it
  const stageHtml = (d) => `<span class="dsc-stage" data-testid="discovery-delivery-stage" data-stage="${esc(d.stage)}">${pill(d.stage)}${d.stage === 'released' && d.release ? ` <span class="mono small">${esc(d.release)}</span>` : ''}</span>`;

  /** A committed card's progress: its stage, the counts, then each issue with its status (its Backlog column, or Released). */
  function deliveryHtml(card) {
    const d = card.delivery;
    if (!d) return `<div class="dsc-delivery muted small" data-testid="discovery-delivery">${esc((card.links?.issues || []).map((n) => `#${n}`).join(', '))}</div>`;
    const counts = COUNTS.filter(([k]) => d.counts?.[k]).map(([k, label]) => `${d.counts[k]} ${label}`).join(' · ');
    return `
      <div class="dsc-delivery" data-testid="discovery-delivery">
        <div class="dsc-delivery-head">${stageHtml(d)} <span class="muted small" data-testid="discovery-delivery-counts">${esc(counts)}</span></div>
        <ul class="dsc-delivery-issues">${(d.issues || []).map((i) => `
          <li>
            ${i.url ? `<a class="mono" href="${esc(i.url)}" target="_blank" rel="noopener" title="${t('discovery_commit.open_the_issue')}">#${esc(i.number)}</a>` : `<span class="mono">#${esc(i.number)}</span>`}
            <span class="dsc-delivery-title" title="${esc(i.title || '')}">${esc(i.title || t('discovery_commit.not_synced_yet'))}</span>
            ${i.release ? pill('released', `Shipped in ${i.release}`) : pill(i.column)}
          </li>`).join('')}</ul>
      </div>`;
  }

  /** The Committed list beside the board ('' without a committed card); `openId`: the card whose panel is open. */
  function committedHtml(cards, openId) {
    if (!cards?.length) return '';
    return `
      <aside class="dsc-committed" data-testid="discovery-committed" aria-label="${t('discovery_commit.committed')}">
        <header class="dsc-col-head">
          <h3 title="${t('discovery_commit.committed_to_the_backlog_these_cards')}">${t('discovery_commit.committed')}</h3>
          <span class="badge dsc-count" title="${t('discovery_commit.length_committed', { length: cards.length })}">${cards.length}</span>
        </header>
        <div class="dsc-committed-list">${cards.map((c) => `
          <article class="dsc-card dsc-committed-card${openId === c.id ? ' active' : ''}" data-testid="discovery-committed-card" data-card="${esc(c.id)}" data-stage="${esc(c.delivery?.stage || '')}">
            <button type="button" class="dsc-card-title" data-testid="discovery-committed-title" data-open="${esc(c.id)}" title="${esc(c.title)}">${esc(c.title)}</button>
            ${deliveryHtml(c)}
          </article>`).join('')}</div>
      </aside>`;
  }

  // ---- the commit dialog --------------------------------------------------------------------------
  const MODAL = `
  <div id="dsc-commit-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="dsc-commit-title" data-testid="discovery-commit-dialog">
    <form id="dsc-commit-form" class="modal-card wide">
      <h3 id="dsc-commit-title">${t('discovery_commit.commit_to_the_backlog')}</h3>
      <p id="dsc-commit-what" class="muted small"></p>
      <div id="dsc-commit-body"></div>
      <label class="check dsc-commit-roadmap"><input type="checkbox" id="dsc-commit-roadmap" data-testid="discovery-commit-roadmap" /> <span>${t('discovery_commit.plan_them_in_the_roadmap_in')}</span></label>
      <p id="dsc-commit-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-commit-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="submit" id="btn-dsc-commit-file" class="btn primary" data-testid="discovery-commit-file" disabled>${t('discovery_commit.file_the_issues')}</button>
      </div>
    </form>
  </div>`;

  const taskWorkflows = () => (state.workflows || []).filter((w) => !w.error && w.inputs?.task);
  const defaultWorkflow = () => window.DefaultWorkflow?.current?.().file || '';

  function workflowOptions(value) {
    const list = taskWorkflows();
    const options = !value || list.some((w) => w.file === value) ? list : [{ file: value, name: value }, ...list];
    return options.map((w) => `<option value="${esc(w.file)}"${w.file === value ? ' selected' : ''}>${esc(w.name || w.file)}${w.file === defaultWorkflow() ? ' (default)' : ''}</option>`).join('');
  }

  const issueHtml = (issue, i, all) => `
    <li class="po-group dsc-commit-issue" data-testid="discovery-commit-issue" data-commit-issue="${i}">
      <div class="po-edit">
        <div class="field">
          <label for="dsc-commit-title-${i}">${t('discovery_commit.issue')} ${i + 1} <span class="req">*</span></label>
          <input type="text" id="dsc-commit-title-${i}" data-commit-title maxlength="200" value="${esc(issue.title)}" autocomplete="off" />
        </div>
        <div class="dsc-commit-grid">
          <div class="field">
            <label for="dsc-commit-cx-${i}">${t('discovery_commit.complexity')}</label>
            <select id="dsc-commit-cx-${i}" data-commit-cx title="${t('discovery_commit.n1_small_to_5_too_big')}">${[1, 2, 3, 4, 5].map((k) => `<option value="${k}"${Number(issue.complexity) === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="dsc-commit-wf-${i}">${t('discovery_commit.workflow')}</label>
            <select id="dsc-commit-wf-${i}" data-commit-wf title="${t('discovery_commit.the_workflow_that_implements_it_its')}">${workflowOptions(issue.workflow || defaultWorkflow())}</select>
          </div>
        </div>
        <div class="field">
          <label for="dsc-commit-tasks-${i}">${t('discovery_commit.tasks')} <span class="req">*</span></label>
          <textarea id="dsc-commit-tasks-${i}" data-commit-tasks rows="${Math.min(8, Math.max(2, issue.tasks.length))}"></textarea>
          <div class="hint">${t('discovery_commit.one_per_line_each_becomes_a')}${issue.reason ? ` ${esc(issue.reason)}` : ''}</div>
        </div>
        ${i < all.length - 1 ? `<div class="row"><button class="link-btn small" type="button" data-commit-merge="${i}" title="${t('discovery_commit.issue_value_s_tasks_join_this', { value: i + 2 })}">${t('discovery_commit.merge_with_issue')} ${i + 2}</button></div>` : ''}
      </div>
    </li>`;

  // #836 the mockup regions the owner selected in the editor: each cropped image with its data-mid; every
  // issue filed carries them (the owner removes an issue's tasks, not its regions)
  const cropsHtml = () => (cm.crops.length ? `
    <section class="dsc-commit-crops" aria-label="${t('discovery_commit.crops')}">
      <h4 class="muted small">${t('discovery_commit.crops')}</h4>
      <div class="row">${cm.crops.map((c) => `
        <figure class="dsc-commit-crop" data-testid="discovery-commit-crop" data-mid="${esc(c.mid)}" title="${esc(c.name)}">
          <img src="mockup://${encodeURIComponent(cm.projectId)}/${esc(c.file)}" alt="${esc(c.name)}" loading="lazy" />
          <figcaption class="mono small">${esc(c.mid)}</figcaption>
        </figure>`).join('')}</div>
    </section>` : '');

  function renderDialog() {
    const body = $('#dsc-commit-body');
    if (cm.loading) body.innerHTML = `<p class="muted small" data-testid="discovery-commit-loading">${t('discovery_commit.the_product_owner_is_proposing_the')}</p>`;
    else {
      body.innerHTML = `${cm.note ? `<p class="muted small" data-testid="discovery-commit-note">${esc(cm.note)}</p>` : ''}
        ${cropsHtml()}
        <ol class="dsc-commit-issues">${cm.issues.map(issueHtml).join('')}</ol>`;
      // set as a value, not as markup: a task keeps its text as written
      [...body.querySelectorAll('[data-commit-tasks]')].forEach((el, i) => { el.value = cm.issues[i].tasks.join('\n'); });
    }
    $('#btn-dsc-commit-file').disabled = cm.loading || cm.busy || !cm.issues.length;
    $('#dsc-commit-roadmap').disabled = cm.loading || cm.busy || cm.preview;
    // filing cannot be called back: no Cancel while it runs
    $('#btn-dsc-commit-cancel').disabled = cm.busy;
  }

  // The rows as the owner left them: what File the issues files.
  function readIssues() {
    return [...document.querySelectorAll('#dsc-commit-body [data-commit-issue]')].map((row, i) => ({
      ...cm.issues[i],
      title: String(row.querySelector('[data-commit-title]').value || '').trim(),
      complexity: Number(row.querySelector('[data-commit-cx]').value) || 1,
      workflow: row.querySelector('[data-commit-wf]').value || null,
      tasks: String(row.querySelector('[data-commit-tasks]').value || '').split('\n').map((t) => t.trim()).filter(Boolean),
    }));
  }

  /**
   * Opens the dialog for a Ready card and asks the Product Owner for the split.
   * `done(out, problems)`: after the issues were filed and the card committed (the dialog is closed).
   */
  async function open({ projectId, card, crops = [], done }) {
    if (cm.busy) return; // the issues of another card are being filed
    const seq = ++cm.seq;
    const preview = !!state.settings?.developerMode && !state.simulationOnly;
    const regions = (Array.isArray(crops) ? crops : []).filter((c) => c?.mid && c?.file).map(({ mid, file, name }) => ({ mid: String(mid), file: String(file), name: String(name || file) }));
    Object.assign(cm, { projectId, card, issues: [], crops: regions, loading: true, busy: false, note: '', done, preview });
    const where = state.simulationOnly ? 'Simulation: they only join this workspace\'s backlog, nothing reaches GitHub or GitLab. The card then leaves the board for the Committed list and never comes back.'
      : preview ? 'Developer mode: File the issues only previews the commands. Nothing is filed and the card stays in Ready.'
        : 'They are filed on the project\'s repository. The card then leaves the board for the Committed list and never comes back.';
    $('#dsc-commit-what').textContent = t('discovery_commit.title_becomes_issues_in_the_backlog', { title: card.title, id: card.id, where });
    $('#dsc-commit-error').textContent = '';
    $('#dsc-commit-roadmap').checked = false;
    renderDialog();
    openModal('#dsc-commit-modal');
    try {
      const out = await api.proposeDiscoveryCommit(projectId, card.id, preview);
      if (seq !== cm.seq) return;
      cm.issues = (out?.split?.issues || []).slice(0, MAX_ISSUES).map((i) => ({ ...i, tasks: [...(i.tasks || [])] }));
      cm.note = out?.fallback ? `The Product Owner could not be asked (${out.fallback}): this is the split by the rules.`
        : out?.model === 'simulated' ? 'Simulated: the split by the rules, no model was called.' : '';
    } catch (e) {
      if (seq !== cm.seq) return;
      $('#dsc-commit-error').textContent = errMsg(e);
    }
    cm.loading = false;
    renderDialog();
    document.querySelector('#dsc-commit-body [data-commit-title]')?.focus({ preventScroll: true });
  }

  function close() {
    if (cm.busy) return;
    cm.seq++;
    Object.assign(cm, { card: null, issues: [], crops: [], loading: false, busy: false, done: null });
    closeModal('#dsc-commit-modal');
  }

  function merge(i) {
    const issues = readIssues();
    if (!issues[i + 1]) return;
    issues[i].tasks.push(...issues[i + 1].tasks);
    issues[i].complexity = Math.min(5, Math.max(issues[i].complexity, issues[i + 1].complexity));
    issues.splice(i + 1, 1);
    cm.issues = issues;
    renderDialog();
  }

  // The filed issues planned in the roadmap, one stage each, in the dialog's order (like Split + roadmap).
  async function planRoadmap(projectId, card, issues) {
    const stages = issues.map((i, n) => {
      const workflow = i.workflow || defaultWorkflow();
      const workflowName = taskWorkflows().find((w) => w.file === workflow)?.name;
      return {
        name: issues.length > 1 ? `${card.title}, part ${n + 1}` : card.title,
        note: '',
        items: [{ workflow, ...(workflowName ? { workflowName } : {}), issues: [i.number], inputs: {}, mock: !!state.simulationOnly, reason: `From discovery card ${card.id}.` }],
      };
    });
    await api.proposeRoadmap(projectId, { stages }, false);
  }

  async function submit(e) {
    e.preventDefault();
    if (cm.busy || cm.loading || !cm.card) return;
    const issues = readIssues();
    const error = $('#dsc-commit-error');
    const bad = issues.findIndex((i) => !i.title || !i.tasks.length);
    if (bad >= 0) { error.textContent = t(issues[bad].title ? 'discovery_commit.issue_value_needs_a_task' : 'discovery_commit.issue_value_needs_a_title', { value: bad + 1 }); return; }
    const { projectId, card, done, preview } = cm;
    const roadmap = $('#dsc-commit-roadmap').checked;
    Object.assign(cm, { issues, busy: true });
    error.textContent = '';
    renderDialog();
    let out;
    try {
      const crops = cm.crops.length ? { crops: cm.crops } : {};
      out = await api.commitDiscoveryCard(projectId, card.id, { issues: issues.map(({ title, tasks, complexity, workflow }) => ({ title, tasks, complexity, workflow, ...crops })) }, preview);
    } catch (err) {
      cm.busy = false;
      renderDialog();
      error.textContent = errMsg(err);
      return;
    }
    if (out.preview) {
      Object.assign(cm, { busy: false, note: `Preview (developer mode): nothing was filed. The app would run: ${(out.commands || []).join(' ; ')}` });
      renderDialog();
      return;
    }
    // the card is committed: what goes wrong from here is told, never undone
    const problems = [];
    if (out.failed?.length) problems.push(`Not filed: ${out.failed.map((f) => f.title).join('; ')} (${out.failed[0].error}). File ${out.failed.length > 1 ? 'them' : 'it'} from the Backlog.`);
    if (out.skippedLabels?.length) problems.push(`Labels the repository does not have were left out: ${out.skippedLabels.join(', ')}.`);
    if (out.syncError) problems.push(`The backlog sync failed: ${out.syncError}`);
    if (roadmap && !out.syncError) {
      try { await planRoadmap(projectId, card, out.issues || []); } catch (err) { problems.push(`Not planned in the roadmap: ${errMsg(err)}`); }
    } else if (roadmap) problems.push('Not planned in the roadmap: sync the backlog, then add the issues to it.');
    cm.busy = false;
    close();
    done?.({ ...out, roadmap }, problems);
  }

  function mount() {
    $('#dsc-commit-form').onsubmit = submit;
    $('#btn-dsc-commit-cancel').onclick = close;
    $('#dsc-commit-body').onclick = (e) => {
      const b = e.target.closest('[data-commit-merge]');
      if (b && !cm.busy) merge(Number(b.dataset.commitMerge));
    };
    // Esc is Cancel (not while the issues are being filed); the card's panel behind stays open
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || $('#dsc-commit-modal').classList.contains('hidden')) return;
      e.preventDefault();
      close();
    });
  }

  window.DiscoveryCommit = {
    actionHtml,
    BAR,
    committedHtml,
    deliveryHtml,
    MODAL,
    mount,
    open,
    underBar,
  };
})();
