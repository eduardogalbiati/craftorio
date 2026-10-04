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
// Browser: window.GateOracle; Node: module.exports (STARTERS, gateContext, gateOracleButtonHtml,
// fillGateFeedback: tested in test/gate-oracle-183.test.js).
(function (root) {
  const STARTERS = [
    'What was implemented, in plain words?',
    'Does it cover every task of the issue?',
    'What could break?',
    'Should I approve or ask for changes?',
  ];
  const OUTPUT_FIELDS = ['summary', 'files_changed', 'test_notes', 'evidence_plan', 'left_out'];
  // what the Oracle is told with the context (the context itself is data, this is how to use it)
  const GUIDE = [
    'The owner is at this human gate and asks you about it. The context below names the run, its branch and base; read the diff and the files with your tools when you need them (repo_git: git diff <base>...<branch> in the project\'s repository; run_events and run_file for the run).',
    'When the run\'s worktree was removed, the diff still comes from the branch; when neither exists, say the diff is not available.',
    'Never answer the gate: the owner does. When the owner should ask for changes, propose the text for "Ask for changes" in a fenced block tagged gate-feedback (```gate-feedback ... ```): the app shows it with a "Use this text" button.',
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
  const contextText = (context) => `${GUIDE}\n\n${JSON.stringify(context, null, 2)}`;

  // the Oracle's state for this gate: thinking (answering about it), busy (answering another question)
  function oracleState(approvalId) {
    const ref = root.OracleChat?.pendingRef?.();
    if (ref == null) return { busy: false, thinking: false };
    return ref === refOf(approvalId) ? { busy: false, thinking: true } : { busy: true, thinking: false };
  }
  const refOf = (approvalId) => `gate:${approvalId}`;

  function avatarHtml(thinking) {
    const svg = root.Robots?.svg ? root.Robots.svg('oracle', thinking ? 'thinking' : 'idle', { bubble: false, plaque: '' }) : '';
    return `<span class="oracle-avatar sm${thinking ? ' thinking' : ''}" aria-hidden="true">${svg}</span>`;
  }

  /** The gate card's button: the Oracle's avatar and "Interact with Oracle" (busy: "Oracle is answering…"). */
  function gateOracleButtonHtml(gate = {}, opts = {}) {
    const id = gate.approval_id || gate.approvalId || '';
    const live = oracleState(id);
    const busy = opts.busy ?? live.busy;
    const thinking = !busy && (opts.thinking ?? live.thinking);
    const label = busy ? 'Oracle is answering…' : 'Interact with Oracle';
    const title = busy ? 'The Oracle is answering another question: yours waits in line' : 'Discuss this gate with the Oracle before answering: what was built, what could break';
    return `<button type="button" class="btn sm ghost gate-oracle" data-testid="gate-oracle" data-gate-oracle="${escHtml(id)}" data-run="${escHtml(gate.run_id || gate.runId || '')}" data-step="${escHtml(gate.step_id || gate.stepId || '')}" title="${escHtml(title)}">${avatarHtml(thinking)}<span class="gate-oracle-label">${label}</span></button>`;
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

  const api$ = { STARTERS, contextText, fillGateFeedback, gateContext, gateOracleButtonHtml };
  if (typeof module === 'object' && module.exports) { module.exports = api$; return; }
  root.GateOracle = api$;

  // ---- the browser side: the gate's data, opening the Oracle, Use this text, repainting ----------
  const cardOf = (approvalId) => document.querySelector(`[data-gate-oracle="${CSS.escape(approvalId)}"]`)?.closest('.run-gate, .duo-ask') || null;

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
    if (!root.OracleChat?.openWith) { showToast?.('The Oracle is not available', 'Its chat did not load in this window.'); return; }
    root.OracleChat.openWith({ label: chip, ref: refOf(approvalId), text: contextText(context), starters: STARTERS });
  }

  // "Use this text" from an Oracle answer: the gate's card (opening its run when it is not in view)
  function useText(ref, text) {
    const approvalId = String(ref || '').replace(/^gate:/, '');
    let card = cardOf(approvalId);
    if (!card) {
      const runId = [...state.runs.entries()].find(([, v]) => v.approvals?.has?.(approvalId))?.[0];
      if (runId) selectRun(runId);
      card = cardOf(approvalId);
    }
    if (!fillGateFeedback(card, text)) showToast('The gate has no feedback box to fill', 'It was answered, or it takes no text: copy the text instead.');
  }

  /** Repaints every gate button (the Oracle started or finished answering). */
  function paint() {
    document.querySelectorAll('[data-gate-oracle]').forEach((b) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = gateOracleButtonHtml({ approval_id: b.dataset.gateOracle, run_id: b.dataset.run, step_id: b.dataset.step });
      b.innerHTML = tmp.firstElementChild.innerHTML;
      b.title = tmp.firstElementChild.title;
    });
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
