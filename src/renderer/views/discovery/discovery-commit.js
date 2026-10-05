/* global api */
// Discovery › the commitment point (#258, src/discovery-commit.js), drawn for the Discovery board
// (views/discovery/discovery.js) as window.DiscoveryCommit:
// - a Ready card's panel offers "Commit to the backlog" (actionHtml): enabled from 85% clarity,
//   disabled under it with why (the panel's Clarity section lists the gaps and offers Grill me);
// - the commit dialog (open): the Product Owner's proposed split, one framed row per issue in the
//   look of the Backlog's split proposals (its title, complexity, workflow and tasks, one per line,
//   all editable; "merge with issue n" joins two), "Plan them in the roadmap, in this order", then
//   File the issues / Cancel. Nothing is filed before File the issues;
// - the Committed list beside the board (committedHtml): each committed card with its delivery
//   (deliveryHtml: the stage In delivery / Delivered / Released, the counts to do, running, merged
//   locally, done, and each issue with the Backlog's column name). A committed card has no
//   "Move to…": it never returns to the board.
// Uses app.js globals ($, esc, state, errMsg, openModal, closeModal) and DefaultWorkflow.
(() => {
  const BAR = 85; // the commit bar (src/discovery-commit.js COMMIT_BAR)
  const STAGES = { in_delivery: 'In delivery', delivered: 'Delivered', released: 'Released' };
  // the Backlog's column names (views/backlog/backlog.js)
  const COLUMNS = { todo: 'To do', in_progress: 'In progress', waiting: 'Waiting for approval', local: 'Merged locally', done: 'Done' };
  const COUNTS = [['todo', 'to do'], ['running', 'running'], ['local', 'merged locally'], ['done', 'done']];
  const MAX_ISSUES = 8;

  // cm: the dialog's card and project, the split being edited, what the proposal said about itself
  const cm = { projectId: null, card: null, issues: [], loading: false, busy: false, note: '', seq: 0, done: null };

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
      <div class="row dsc-actions" role="group" aria-label="Ready">
        <button type="button" class="btn sm primary" data-testid="discovery-commit" data-detail="commit"${under ? ' disabled' : ''} title="${esc(under ? why : 'The Product Owner proposes the issues this card becomes; you edit and confirm before anything is filed')}">Commit to the backlog</button>
      </div>
      <p class="muted small dsc-actions-hint" data-testid="discovery-commit-hint">${esc(under ? why : 'The card becomes one or more issues in the Backlog and leaves the board for the Committed list: it never comes back.')}</p>`;
  }

  // ---- delivery -----------------------------------------------------------------------------------
  const stageBadge = (d) => `<span class="badge dsc-stage ${esc(d.stage)}" data-testid="discovery-delivery-stage"${d.release ? ` title="${esc(`Shipped in ${d.release}`)}"` : ''}>${esc(STAGES[d.stage] || d.stage)}${d.stage === 'released' && d.release ? ` ${esc(d.release)}` : ''}</span>`;

  /** A committed card's progress: its stage, the counts, then each issue with its Backlog column. */
  function deliveryHtml(card) {
    const d = card.delivery;
    if (!d) return `<div class="dsc-delivery muted small" data-testid="discovery-delivery">${esc((card.links?.issues || []).map((n) => `#${n}`).join(', '))}</div>`;
    const counts = COUNTS.filter(([k]) => d.counts?.[k]).map(([k, label]) => `${d.counts[k]} ${label}`).join(' · ');
    return `
      <div class="dsc-delivery" data-testid="discovery-delivery">
        <div class="dsc-delivery-head">${stageBadge(d)} <span class="muted small" data-testid="discovery-delivery-counts">${esc(counts)}</span></div>
        <ul class="dsc-delivery-issues">${(d.issues || []).map((i) => `
          <li>
            ${i.url ? `<a class="mono" href="${esc(i.url)}" target="_blank" rel="noopener" title="Open the issue">#${esc(i.number)}</a>` : `<span class="mono">#${esc(i.number)}</span>`}
            <span class="dsc-delivery-title" title="${esc(i.title || '')}">${esc(i.title || 'not synced yet')}</span>
            <span class="badge dsc-issue-col ${esc(i.release ? 'released' : i.column)}"${i.release ? ` title="${esc(`Shipped in ${i.release}`)}"` : ''}>${esc(i.release ? 'Released' : COLUMNS[i.column] || i.column)}</span>
          </li>`).join('')}</ul>
      </div>`;
  }

  /** The Committed list beside the board ('' without a committed card); `openId`: the card whose panel is open. */
  function committedHtml(cards, openId) {
    if (!cards?.length) return '';
    return `
      <aside class="dsc-committed" data-testid="discovery-committed" aria-label="Committed">
        <header class="dsc-col-head">
          <h3 title="Committed to the backlog: these cards follow their issues to the release and never return to the board">Committed</h3>
          <span class="badge dsc-count" title="${cards.length} committed">${cards.length}</span>
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
      <h3 id="dsc-commit-title">Commit to the backlog</h3>
      <p id="dsc-commit-what" class="muted small"></p>
      <div id="dsc-commit-body"></div>
      <label class="check dsc-commit-roadmap"><input type="checkbox" id="dsc-commit-roadmap" data-testid="discovery-commit-roadmap" /> <span>Plan them in the roadmap, in this order</span></label>
      <p id="dsc-commit-error" class="error small" role="alert"></p>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" id="btn-dsc-commit-cancel" class="btn ghost">Cancel</button>
        <button type="submit" id="btn-dsc-commit-file" class="btn primary" data-testid="discovery-commit-file" disabled>File the issues</button>
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
          <label for="dsc-commit-title-${i}">Issue ${i + 1} <span class="req">*</span></label>
          <input type="text" id="dsc-commit-title-${i}" data-commit-title maxlength="200" value="${esc(issue.title)}" autocomplete="off" />
        </div>
        <div class="dsc-commit-grid">
          <div class="field">
            <label for="dsc-commit-cx-${i}">Complexity</label>
            <select id="dsc-commit-cx-${i}" data-commit-cx title="1 (small) to 5 (too big for one run)">${[1, 2, 3, 4, 5].map((k) => `<option value="${k}"${Number(issue.complexity) === k ? ' selected' : ''}>${k}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="dsc-commit-wf-${i}">Workflow</label>
            <select id="dsc-commit-wf-${i}" data-commit-wf title="The workflow that implements it (its roadmap item's)">${workflowOptions(issue.workflow || defaultWorkflow())}</select>
          </div>
        </div>
        <div class="field">
          <label for="dsc-commit-tasks-${i}">Tasks <span class="req">*</span></label>
          <textarea id="dsc-commit-tasks-${i}" data-commit-tasks rows="${Math.min(8, Math.max(2, issue.tasks.length))}"></textarea>
          <div class="hint">One per line: each becomes a checkbox of the issue.${issue.reason ? ` ${esc(issue.reason)}` : ''}</div>
        </div>
        ${i < all.length - 1 ? `<div class="row"><button class="link-btn small" type="button" data-commit-merge="${i}" title="Issue ${i + 2}'s tasks join this one">merge with issue ${i + 2}</button></div>` : ''}
      </div>
    </li>`;

  function renderDialog() {
    const body = $('#dsc-commit-body');
    if (cm.loading) body.innerHTML = '<p class="muted small" data-testid="discovery-commit-loading">The Product Owner is proposing the split…</p>';
    else {
      body.innerHTML = `${cm.note ? `<p class="muted small" data-testid="discovery-commit-note">${esc(cm.note)}</p>` : ''}
        <ol class="dsc-commit-issues">${cm.issues.map(issueHtml).join('')}</ol>`;
      // set as a value, not as markup: a task keeps its text as written
      [...body.querySelectorAll('[data-commit-tasks]')].forEach((el, i) => { el.value = cm.issues[i].tasks.join('\n'); });
    }
    $('#btn-dsc-commit-file').disabled = cm.loading || cm.busy || !cm.issues.length;
    $('#dsc-commit-roadmap').disabled = cm.loading || cm.busy;
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
  async function open({ projectId, card, done }) {
    const seq = ++cm.seq;
    Object.assign(cm, { projectId, card, issues: [], loading: true, busy: false, note: '', done });
    $('#dsc-commit-what').textContent = `"${card.title}" becomes issues in the Backlog, each with "From discovery card ${card.id}", its tasks and the card's document. ${state.simulationOnly
      ? 'Simulation: they only join this workspace\'s backlog, nothing reaches GitHub or GitLab.' : 'They are filed on the project\'s repository.'} The card then leaves the board for the Committed list and never comes back.`;
    $('#dsc-commit-error').textContent = '';
    $('#dsc-commit-roadmap').checked = false;
    renderDialog();
    openModal('#dsc-commit-modal');
    try {
      const out = await api.proposeDiscoveryCommit(projectId, card.id);
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
    cm.seq++;
    Object.assign(cm, { card: null, issues: [], loading: false, busy: false, done: null });
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
    if (bad >= 0) { error.textContent = `Issue ${bad + 1} needs ${issues[bad].title ? 'at least one task' : 'a title'}.`; return; }
    const { projectId, card, done } = cm;
    const roadmap = $('#dsc-commit-roadmap').checked;
    Object.assign(cm, { issues, busy: true });
    error.textContent = '';
    renderDialog();
    let out;
    try {
      out = await api.commitDiscoveryCard(projectId, card.id, { issues: issues.map(({ title, tasks, complexity, workflow }) => ({ title, tasks, complexity, workflow })) });
    } catch (err) {
      cm.busy = false;
      renderDialog();
      error.textContent = errMsg(err);
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
