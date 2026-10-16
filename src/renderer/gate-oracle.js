/* global state, lastOutput, issuesOfRun, showToast, selectRun */
// "Interact with Oracle" on a human gate (#183): a button with the Oracle's avatar in every gate
// card's choices row (Run screen, run chat, Write & Review). It opens the Oracle's drawer beside the
// gate (window.OracleChat.openWith, views/oracle/oracle.js) with a removable context chip ("Run <id> ·
// #<issue> · <step> · branch <b>") and starter questions. The question carries the gate as context:
// the run, project, issues, step, workflow and version, branch and base, the gate's message and
// choices and the developer's output; never the diff (the Oracle reads it with repo_git). While the
// Oracle answers about this gate its avatar thinks; while it answers another question the button
// says "Oracle is answering…" (the question queues). The Oracle proposes "Ask for changes" text in a
// ```gate-feedback block; its "Use this text" fills the gate's feedback box (fillGateFeedback): it
// never answers the gate (#123: gates stay the owner's).
// "Ask the Oracle about this failure" on a roadmap item (#271, views/backlog/backlog-roadmap.js) shares
// this code: the same button (oracleButtonHtml: avatar, label, the busy state) and the same way of
// opening the drawer (ask). Its context (failureContext) names the item's run, issues, workflow, last
// step, status and error, and the roadmap's state (a start that was refused has no run: the item, its
// error and the roadmap); its first question is sent at once (queued while the Oracle answers another).
// Browser: window.GateOracle; Node: module.exports (STARTERS, gateContext, gateOracleButtonHtml,
// fillGateFeedback, failureContext, failureButtonHtml: tested in test/gate-oracle-183.test.js and
// test/renderer-roadmap-ask-oracle-271.test.js).
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const STARTERS = [
    'What was implemented, in plain words?',
    'Does it cover every task of the issue?',
    'What could break?',
    'Should I approve or ask for changes?',
  ];
  const OUTPUT_FIELDS = ['summary', 'files_changed', 'test_notes', 'evidence_plan', 'left_out'];
  // what the Oracle is told with the context (the context itself is data, this is how to use it)
  const GUIDE = [
    `The owner is at this human gate and asks you about it. The context below names the run, its branch and base; read the diff and the files with your tools when you need them (repo_git: git diff <base>...<branch> ${t('gate_oracle.in_the_project_s_repository_run')}`,
    'When the run\'s worktree was removed, the diff still comes from the branch; when neither exists, say the diff is not available.',
    'Never answer the gate: the owner does. When the owner should ask for changes, propose the text for "Ask for changes" in a fenced block tagged gate-feedback (```gate-feedback ... ```): the app shows it with a "Use this text" button.',
  ].join('\n');
  // #271: a roadmap item that did not finish
  const FAILURE_QUESTION = 'What happened to this run, and what should I do: retry, resume from a step, skip or fix something first?';
  const FAILURE_STARTERS = [
    'Is it a flaky test or a real bug?',
    'What would resuming from a step keep?',
    'Is it safe to skip it and go on?',
  ];
  const FAILURE_GUIDE = [
    'The owner asks about a roadmap item that did not finish: its run failed, was interrupted or stopped, or it could not start. The context below names the item, its run and the roadmap\'s state; read the run with your tools (run_events and run_file for its events, log and files; repo_git for its branch and whether its worktree still exists). Without a run id the start was refused before any run: explain the error.',
    'Say what happened and what to do next: retry, resume from a step (and what that keeps), skip, or fix something first.',
    'You may propose an action card (Retry, Resume from step, Skip, file an issue): it runs only when the owner clicks it. Never retry, skip or answer a gate yourself.',
  ].join('\n');

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const issueOf = (i) => (i && typeof i === 'object' ? { number: i.number ?? null, url: i.url || null, title: i.title || null } : { number: i ?? null, url: null, title: null });

  /** { chip, context } of a gate: the chip's one line and the data the question carries. */
  function gateContext({ run = {}, gate = {}, output = null } = {}) {
    const issues = (run.issues || []).filter((i) => i != null).map(issueOf);
    const step = gate.step_id || gate.stepId || '';
    const branch = run.branch || output?.branch || gate.branch || null;
    const base = run.base || gate.diff_base || gate.diffBase || null;
    const runId = run.run_id || gate.run_id || '';
    const chip = [
      `Run ${runId}`,
      issues.length ? issues.map((i) => `#${i.number}`).join(', ') : '',
      step,
      branch ? `branch ${branch}` : '',
    ].filter(Boolean).join(' · ');
    const developer = {};
    for (const k of OUTPUT_FIELDS) if (output && output[k] != null && output[k] !== '') developer[k] = output[k];
    const context = {
      about: 'human gate',
      run_id: runId,
      project: run.project_id || run.project || null,
      issues,
      workflow: run.workflow || null,
      version: run.version || null,
      branch,
      base,
      worktree: gate.work_dir || gate.workDir || null,
      step,
      gate: {
        approval_id: gate.approval_id || gate.approvalId || null,
        message: gate.message || '',
        choices: (gate.choices || []).map((c) => ({ id: c.id, label: c.label })),
      },
      developer_output: developer,
    };
    return { chip, context };
  }

  /** The text sent with each question while the chip is on: how to use it, then the context. */
  const contextText = (context, guide = GUIDE) => `${guide}\n\n${JSON.stringify(context, null, 2)}`;

  // the Oracle's state for a question's ref: thinking (answering about it), busy (answering another question)
  function oracleState(ref) {
    const pending = root.OracleChat?.pendingRef?.();
    if (pending == null) return { busy: false, thinking: false };
    return pending === ref ? { busy: false, thinking: true } : { busy: true, thinking: false };
  }
  const refOf = (approvalId) => `gate:${approvalId}`;
  const failureRef = (item) => `roadmap:${item?.id || ''}`;

  function avatarHtml(thinking) {
    const svg = root.Robots?.svg ? root.Robots.svg('oracle', thinking ? 'thinking' : 'idle', { bubble: false, plaque: '' }) : '';
    return `<span class="oracle-avatar sm${thinking ? ' thinking' : ''}" data-testid="oracle-avatar" aria-hidden="true">${svg}</span>`;
  }

  /**
   * The button both screens share (#183 gates, #271 roadmap items): the Oracle's avatar and `label`;
   * while the Oracle answers another question it says "Oracle is answering…" (the question queues).
   * `attrs`: the caller's own attributes (already escaped), e.g. its data-testid.
   */
  function oracleButtonHtml({ ref, label, title, attrs = '', busy, thinking } = {}) {
    const live = oracleState(ref);
    const waits = busy ?? live.busy;
    const thinks = !waits && (thinking ?? live.thinking);
    const tip = waits ? 'The Oracle is answering another question: yours waits in line' : title;
    return `<button type="button" class="btn sm ghost gate-oracle" ${attrs} title="${escHtml(tip)}">${avatarHtml(thinks)}<span class="gate-oracle-label">${waits ? t('gate_oracle.oracle_is_answering') : escHtml(label)}</span></button>`;
  }

  /** The gate card's button: the Oracle's avatar and "Interact with Oracle" (busy: "Oracle is answering…"). */
  function gateOracleButtonHtml(gate = {}, opts = {}) {
    const id = gate.approval_id || gate.approvalId || '';
    return oracleButtonHtml({
      ref: refOf(id),
      label: t('gate_oracle.interact_with_oracle'),
      title: t('gate_oracle.discuss_this_gate_with_the_oracle'),
      attrs: `data-testid="gate-oracle" data-gate-oracle="${escHtml(id)}" data-run="${escHtml(gate.run_id || gate.runId || '')}" data-step="${escHtml(gate.step_id || gate.stepId || '')}"`,
      busy: opts.busy,
      thinking: opts.thinking,
    });
  }

  /**
   * { chip, context } of a roadmap item that did not finish (#271). `item`: the roadmap's item with
   * its `run` (the service's view); `run`: what the app knows of the run (branch, base), when loaded;
   * `roadmap`, `stage` (its index) and `project`: where the item is.
   */
  function failureContext({ item = {}, run = null, roadmap = null, stage = null, project = null } = {}) {
    const issues = (item.issues?.length ? item.issues : item.number ? [item] : []).map(issueOf);
    const runId = item.runId || null;
    const ended = item.run?.status || null;
    const status = !runId ? 'failed to start' : ended === 'interrupted' ? 'interrupted' : ended === 'cancelled' ? 'stopped' : item.status || ended || 'failed';
    const last = Array.isArray(item.run?.progress) ? item.run.progress.at(-1) : null;
    const step = (typeof last === 'string' ? last : last?.step || last?.id) || null;
    const numbers = issues.map((i) => `#${i.number}`).join(', ');
    const chip = [runId ? `Run ${runId}` : 'Roadmap item', numbers, runId && step ? `${status} at ${step}` : status].filter(Boolean).join(' · ');
    const context = {
      about: 'roadmap item that did not finish',
      run_id: runId,
      project,
      issues,
      workflow: item.workflow || null,
      step,
      status,
      error: item.error || item.run?.error || null,
      branch: run?.branch || null,
      base: run?.base || null,
      // the screen does not know whether the worktree is still there: repo_git and run_file tell
      worktree: null,
      roadmap: roadmap ? {
        state: roadmap.state || null,
        paused_by_this_item: !!item.id && roadmap.pausedBy === item.id,
        error: roadmap.error || null,
        stage: stage != null && stage >= 0 ? stage + 1 : null,
      } : null,
    };
    return { chip, context };
  }

  /** A roadmap card's button: "Ask the Oracle about this failure" ("… this interruption" for an interrupted run). */
  function failureButtonHtml(item = {}, attrs = '') {
    const what = item.run?.status === 'interrupted' ? 'interruption' : 'failure';
    return oracleButtonHtml({
      ref: failureRef(item),
      label: t('gate_oracle.ask_the_oracle_about_this_what', { what }),
      title: t('gate_oracle.opens_the_oracle_beside_the_roadmap'),
      attrs: `${attrs} data-oracle-ask="${escHtml(failureRef(item))}" data-oracle-what="${what}"`.trim(),
    });
  }

  /** Opens the Oracle's drawer on something on screen: its chip and starters; `question` is sent at once (queued while it answers another). */
  function ask({ chip, context, ref, starters = STARTERS, question = '', guide = GUIDE } = {}) {
    if (!root.OracleChat?.openWith) { root.showToast?.(t('gate_oracle.the_oracle_is_not_available'), t('gate_oracle.its_chat_did_not_load_in')); return false; }
    root.OracleChat.openWith({ label: chip, ref, text: contextText(context, guide), starters, ...(question ? { question } : {}) });
    return true;
  }

  /** #271: the Oracle asked what happened to a roadmap item (failureContext's arguments). */
  function askAboutFailure(about = {}) {
    const { chip, context } = failureContext(about);
    return ask({ chip, context, ref: failureRef(about.item), starters: FAILURE_STARTERS, question: FAILURE_QUESTION, guide: FAILURE_GUIDE });
  }

  /** "Use this text": the gate card's feedback box gets the text; the gate is not answered. */
  function fillGateFeedback(card, text) {
    const box = card?.querySelector?.('textarea.duo-ask-text') || card?.querySelector?.('textarea');
    if (!box || box.disabled) return false;
    box.value = String(text ?? '');
    if (typeof Event === 'function') box.dispatchEvent?.(new Event('input', { bubbles: true }));
    box.focus?.({ preventScroll: true });
    return true;
  }

  const api$ = {
    FAILURE_QUESTION,
    FAILURE_STARTERS,
    STARTERS,
    ask,
    askAboutFailure,
    contextText,
    failureButtonHtml,
    failureContext,
    fillGateFeedback,
    gateContext,
    gateOracleButtonHtml,
  };
  if (typeof module === 'object' && module.exports) { module.exports = api$; return; }
  root.GateOracle = api$;

  // ---- the browser side: the gate's data, opening the Oracle, Use this text, repainting ----------
  // the gate's card in a visible view: a hidden screen (Details behind Chat) keeps its old cards
  const cardOf = (approvalId) => [...document.querySelectorAll(`[data-gate-oracle="${CSS.escape(approvalId)}"]`)]
    .find((b) => !b.closest('.view.hidden, .hidden'))?.closest('.run-gate, .duo-ask') || null;

  function gateData(runId, approvalId, stepId) {
    const entry = state.runs.get(runId) || {};
    const fromEvents = (entry.events || []).find((e) => e.type === 'approval.requested' && e.approval_id === approvalId);
    const gate = { run_id: runId, step_id: stepId, ...(fromEvents || {}), ...(entry.approvals?.get?.(approvalId) || {}) };
    const r = entry.run || {};
    const run = {
      run_id: runId,
      project_id: r.project || null,
      workflow: r.workflow || null,
      version: r.version || null,
      issues: typeof issuesOfRun === 'function' ? issuesOfRun(r) : r.issues || [],
      branch: r.branch || null,
      base: r.base || null,
    };
    // the developer's output: the latest step output with a summary or changed files
    const output = typeof lastOutput === 'function' ? lastOutput(runId, (o) => !!(o.summary || o.files_changed)) : null;
    return { run, gate, output };
  }

  function open(btn) {
    const { gateOracle: approvalId, run: runId, step } = btn.dataset;
    const { chip, context } = gateContext(gateData(runId, approvalId, step));
    ask({ chip, context, ref: refOf(approvalId) });
  }

  // "Use this text" from an Oracle answer: the gate's card (opening its run when it is not in view)
  function useText(ref, text) {
    const approvalId = String(ref || '').replace(/^gate:/, '');
    const fill = () => {
      if (!fillGateFeedback(cardOf(approvalId), text)) showToast(t('gate_oracle.the_gate_has_no_feedback_box'), t('gate_oracle.it_was_answered_or_it_takes'));
    };
    if (cardOf(approvalId)) { fill(); return; }
    const runId = [...state.runs.entries()].find(([, v]) => v.approvals?.has?.(approvalId))?.[0];
    if (!runId) { fill(); return; }
    // selectRun only schedules the render (a frame): fill the box in the frame after it
    selectRun(runId);
    requestAnimationFrame(() => requestAnimationFrame(fill));
  }

  /** Repaints every Oracle button, the gates' and the roadmap's (the Oracle started or finished answering). */
  function paint() {
    const repaint = (b, html) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      b.innerHTML = tmp.firstElementChild.innerHTML;
      b.title = tmp.firstElementChild.title;
    };
    document.querySelectorAll('[data-gate-oracle]').forEach((b) => repaint(b, gateOracleButtonHtml({ approval_id: b.dataset.gateOracle, run_id: b.dataset.run, step_id: b.dataset.step })));
    document.querySelectorAll('[data-oracle-ask]').forEach((b) => repaint(b, failureButtonHtml({ id: b.dataset.oracleAsk.replace(/^roadmap:/, ''), run: { status: b.dataset.oracleWhat === 'interruption' ? 'interrupted' : 'failed' } })));
  }

  root.GateOracle.open = open;
  root.GateOracle.paint = paint;
  root.GateOracle.useText = useText;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-gate-oracle]');
      if (btn) open(btn);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
