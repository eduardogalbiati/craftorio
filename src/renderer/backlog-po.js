// Backlog › Product Owner (#105): the floating robot button at the bottom right of the Backlog opens
// the Product Owner's drawer (#po-drawer): suggested questions as chips, a free text box, and the
// project's conversation (kept by the service until cleared, src/product-owner.js). Each answer
// shows its cost and, when it has them, the proposed groups (issues, workflow, inputs, why, files,
// stage, size: complexity, an estimate from past runs, warnings), the issues that must not run in
// parallel and the issues to enrich first. A group is applied only on the owner's click: Assign
// (the assign dialog prefilled) or Add to roadmap (a new stage), through window.BacklogActions
// (backlog.js); "Add all to the roadmap" sends the groups as planned stages (api.proposeRoadmap).
// Developer or simulated mode asks the simulated Product Owner (no model call).
// Uses app.js globals ($, esc, state, errMsg, devMode, fmtCost, markdownHtml, confirmDialog) and
// window.Robots (robots.js).
/* global api, Robots */
(() => {
  const QUESTIONS = [
    'Analyze the backlog and propose runs',
    'What should not run together?',
    'Build a roadmap',
    'Which issues are too big or unclear?',
  ];
  const po = { open: false, busy: false, projectId: null, messages: [], pending: null, error: null, notes: {} };
  const $p = (sel) => document.querySelector(sel);
  const actions = () => window.BacklogActions;
  const issueOf = (n) => (actions()?.data()?.issues || []).find((i) => i.number === n);
  const avatar = (st = 'idle') => (window.Robots ? Robots.svg('product-owner', st, { bubble: false, plaque: '' }) : '');

  function renderButton() {
    $p('#btn-bl-po').innerHTML = avatar();
    $p('#po-avatar').innerHTML = avatar(po.busy ? 'thinking' : 'idle');
  }

  async function open() {
    const projectId = actions()?.projectId();
    if (!projectId) return;
    if (po.projectId !== projectId) Object.assign(po, { projectId, messages: [], pending: null, error: null, notes: {} });
    po.open = true;
    $p('#po-drawer').classList.add('open');
    $p('#po-drawer').setAttribute('aria-hidden', 'false');
    $p('#po-backdrop').classList.remove('hidden');
    render();
    try { po.messages = await api.productOwnerHistory(projectId); } catch (e) { po.error = errMsg(e); }
    render();
    setTimeout(() => $p('#po-question').focus(), 200);
  }

  function close() {
    po.open = false;
    $p('#po-drawer').classList.remove('open');
    $p('#po-drawer').setAttribute('aria-hidden', 'true');
    $p('#po-backdrop').classList.add('hidden');
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (!q || po.busy || !po.projectId) return;
    const projectId = po.projectId;
    Object.assign(po, { busy: true, pending: q, error: null });
    $p('#po-question').value = '';
    render();
    try {
      const out = await api.askProductOwner(projectId, q, devMode());
      if (po.projectId === projectId) po.messages = out.messages;
    } catch (e) {
      if (po.projectId === projectId) po.error = errMsg(e);
    } finally {
      Object.assign(po, { busy: false, pending: null });
      render();
    }
  }

  // ---- rendering ---------------------------------------------------------------------------------
  const issueRef = (n) => {
    const i = issueOf(n);
    return i?.url ? `<a class="badge po-issue" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.title)}">#${n}</a>` : `<span class="badge po-issue">#${n}</span>`;
  };
  const sizeText = (g) => {
    const est = g.estimate
      ? `≈ ${g.estimate.minutes} min · ≈ $${Number(g.estimate.costUsd).toFixed(2)} <span class="muted">(estimate from ${esc(g.estimate.basis)})</span>`
      : '<span class="muted">no past run to estimate from</span>';
    return `complexity ${g.complexity}${g.guessed ? ' <span class="muted" title="Some issues have no complexity:n label: counted as 3">(some guessed)</span>' : ''} · ${est}`;
  };

  function groupHtml(g, m, n) {
    const inputs = Object.entries(g.inputs || {});
    const key = `${m}:${n}`;
    return `
      <div class="po-group" data-msg="${m}" data-group="${n}">
        <div class="po-group-head">
          <span class="badge">stage ${g.stage}</span>
          <b>${esc(g.name)}</b>
          <span class="po-issues">${g.issues.map(issueRef).join('')}</span>
        </div>
        <div class="small"><span class="muted">workflow</span> <span class="mono">${esc(g.workflow)}</span>${inputs.length ? ` · <span class="muted">inputs</span> ${inputs.map(([k, v]) => `<span class="mono">${esc(k)}=${esc(v)}</span>`).join(', ')}` : ''}</div>
        ${g.reason ? `<div class="small">${esc(g.reason)}</div>` : ''}
        ${g.modeReason ? `<div class="small"><span class="muted">mode:</span> ${esc(g.modeReason)}</div>` : ''}
        ${g.files?.length ? `<div class="small muted">files: <span class="mono">${g.files.map(esc).join(', ')}</span></div>` : ''}
        <div class="small po-size">${sizeText(g)}</div>
        ${(g.warnings || []).map((w) => `<div class="small warn-text">⚠ ${esc(w)}</div>`).join('')}
        <div class="row po-group-actions">
          <button class="btn sm primary" type="button" data-po-act="assign" title="Open the assign dialog with these issues as one run">Assign…</button>
          <button class="btn sm ghost" type="button" data-po-act="roadmap" title="Plan this group as a new stage at the end of the roadmap">Add to roadmap</button>
          ${po.notes[key] ? `<span class="small ${po.notes[key].error ? 'error' : 'muted'}">${esc(po.notes[key].text)}</span>` : ''}
        </div>
      </div>`;
  }

  function answerHtml(a, m) {
    if (!a) return '';
    const parts = [];
    if (a.groups?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Proposed runs</div>${a.groups.map((g, n) => groupHtml(g, m, n)).join('')}
        <div class="row"><button class="btn sm ghost" type="button" data-po-act="roadmap-all" data-msg="${m}" title="Every group as a planned stage (by its stage number) at the end of the roadmap">Add all to the roadmap</button>
        ${po.notes[`${m}:all`] ? `<span class="small ${po.notes[`${m}:all`].error ? 'error' : 'muted'}">${esc(po.notes[`${m}:all`].text)}</span>` : ''}</div></div>`);
    }
    if (a.conflicts?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Do not run in parallel</div><ul class="po-list">${a.conflicts.map((c) =>
        `<li>${c.issues.map(issueRef).join(' ⟷ ')} ${esc(c.reason)}${c.files?.length ? ` <span class="muted mono small">${c.files.map(esc).join(', ')}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (a.enrich?.length) {
      parts.push(`<div class="po-sec"><div class="sup-h">Enrich first</div><ul class="po-list">${a.enrich.map((e) =>
        `<li>${issueRef(e.issue)} ${esc(e.reason)} <a class="small" href="${esc(e.link)}" target="_blank" rel="noopener" title="Enrich an issue (#103)">how to enrich (#103)</a></li>`).join('')}</ul></div>`);
    }
    return parts.join('');
  }

  function messageHtml(msg, m) {
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    if (msg.role === 'user') return `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You · ${esc(time)}</div><div>${esc(msg.text)}</div></div>`;
    const meta = `Product Owner · ${esc(time)}${msg.model ? ` · ${esc(msg.model)}` : ''} · ${esc(fmtCost(msg.costUsd || 0))}`;
    return `<div class="sup-wmsg po-msg${msg.error ? ' error' : ''}"><div class="sup-wmsg-meta">${meta}</div>
      <div class="md md-compact">${msg.error ? esc(msg.text) : markdownHtml(msg.text || '')}</div>
      ${msg.invalid ? `<p class="small muted">The answer had no valid proposal (${esc(msg.invalid)}): shown as text only.</p>` : ''}
      ${answerHtml(msg.answer, m)}</div>`;
  }

  function render() {
    renderButton();
    if (!po.open) return;
    const agent = window.productOwnerAgent;
    const simulated = devMode();
    $p('#po-sub').textContent = `${po.projectId || ''} · ${simulated ? 'simulated (developer mode)' : `${agent?.model || 'claude-opus-5-5'}${agent?.effort && agent.effort !== 'default' ? ` · ${agent.effort}` : ''}`}`;
    const log = $p('#po-log');
    const cost = po.messages.reduce((a, x) => a + (x.costUsd || 0), 0);
    log.innerHTML = (po.messages.length || po.pending ? '' : `<div class="po-empty"><span class="po-empty-robot" aria-hidden="true">${avatar()}</span>
        <p class="muted small">I read the synced issues, the queue, the runs in progress and past runs (and the code, read-only), and propose which issues to run together, which not, and in what order. I never start runs or edit issues: you apply a proposal with a click.</p></div>`)
      + po.messages.map(messageHtml).join('')
      + (po.pending ? `<div class="sup-wmsg user"><div class="sup-wmsg-meta">You</div><div>${esc(po.pending)}</div></div>` : '')
      + (po.busy ? '<div class="sup-loading"><span class="spinner"></span><span>The Product Owner is reading the backlog…</span></div>' : '')
      + (po.error ? `<p class="error small">${esc(po.error)}</p>` : '');
    log.scrollTop = log.scrollHeight;
    $p('#po-chips').innerHTML = QUESTIONS.map((q) => `<button class="chip" type="button" data-q="${esc(q)}"${po.busy ? ' disabled' : ''}>${esc(q)}</button>`).join('');
    $p('#btn-po-ask').disabled = po.busy;
    $p('#btn-po-clear').disabled = po.busy || !po.messages.length;
    $p('#po-note').textContent = `${simulated ? 'Simulated: no model is called and nothing is spent.' : 'Each question is one call to the model: it uses your Claude Code subscription.'}${cost ? ` Conversation cost ${fmtCost(cost)}.` : ''}`;
  }

  // ---- applying a proposal (the owner's click) ------------------------------------------------------
  const leftOut = (skipped) => (skipped.length ? ` Left out (not To do): ${skipped.map((n) => `#${n}`).join(', ')}.` : '');
  async function apply(act, el) {
    const box = el.closest('[data-msg]');
    const m = Number(box.dataset.msg);
    const answer = po.messages[m]?.answer;
    if (!answer) return;
    if (act === 'roadmap-all') {
      const stages = [...new Set(answer.groups.map((g) => g.stage))].sort((a, b) => a - b).map((s) => ({
        name: `Stage ${s} (Product Owner)`,
        note: '',
        items: answer.groups.filter((g) => g.stage === s).map((g) => ({ workflow: g.workflow, issues: g.issues, inputs: g.inputs, mock: !!state.simulationOnly, reason: g.reason, modeReason: g.modeReason })),
      }));
      try {
        const out = await api.proposeRoadmap(po.projectId, { stages }, false);
        actions().showRoadmap(out);
        po.notes[`${m}:all`] = { text: `Added to the roadmap as planned.${out.dropped?.length ? ` Already planned, left out: ${out.dropped.map((n) => `#${n}`).join(', ')}.` : ''}` };
      } catch (e) { po.notes[`${m}:all`] = { text: errMsg(e), error: true }; }
      render();
      return;
    }
    const n = Number(box.dataset.group);
    const g = answer.groups[n];
    const key = `${m}:${n}`;
    try {
      if (act === 'assign') {
        const skipped = await actions().assignGroup(g);
        po.notes[key] = skipped.length === g.issues.length ? { text: 'None of these issues is To do any more.', error: true } : skipped.length ? { text: leftOut(skipped).trim() } : null;
      } else {
        const skipped = await actions().roadmapGroup(g);
        po.notes[key] = { text: `Added as a new roadmap stage.${leftOut(skipped)}` };
      }
    } catch (e) { po.notes[key] = { text: errMsg(e), error: true }; }
    render();
  }

  // ---- events ----------------------------------------------------------------------------------------
  $p('#btn-bl-po').onclick = open;
  $p('#btn-po-close').onclick = close;
  $p('#po-backdrop').onclick = close;
  $p('#btn-po-ask').onclick = () => ask($p('#po-question').value);
  $p('#po-question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
  });
  $p('#po-chips').onclick = (e) => { const c = e.target.closest('[data-q]'); if (c) ask(c.dataset.q); };
  $p('#po-log').onclick = (e) => { const b = e.target.closest('[data-po-act]'); if (b) apply(b.dataset.poAct, b); };
  $p('#btn-po-clear').onclick = async () => {
    if (!await confirmDialog('Clear the conversation', 'The Product Owner forgets this project\'s questions and answers.', 'Clear')) return;
    try { po.messages = await api.clearProductOwner(po.projectId); po.notes = {}; } catch (e) { po.error = errMsg(e); }
    render();
  };
  // capture: runs before app.js's Esc handler closes a dialog over the drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && po.open && !document.querySelector('.modal:not(.hidden)')) close();
  }, true);
  document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'product-owner') renderButton(); });
  renderButton();
})();
