// @ts-check
// Human gates, `type: human_approval` (#250, from packages/engine/engine/workflow.js): `openGate` runs the gate's
// `check:` then `requestApproval` emits approval.requested (choices, feedback, local preview, diff,
// the gate brief) and waits for `resolveApproval` (the public API the service and the UI answer
// with; a `feedback_required` choice without a text is refused); `withdrawApproval` closes an
// open gate, `pendingGates` lists them for runs:active. The time a gate is open is not run time
// (`syncGateClock`, #416), and an answer given while the run is over a limit stops the run at the
// gate before it is taken. Automation never crosses a gate:
// `kind: escalation` only lets the supervisor on call try first (packages/engine/engine/run/supervision.js).

'use strict';

const { checkAttachments } = require('../providers');
const gateSummary = require('../gate-summary');
const mergeQueue = require('../merge-queue');
const { render } = require('./templates');
const { parseDuration } = require('./load');
const { extractJson, validateSchema } = require('./outputs');
const { pausedError } = require('./resume');

// What the supervisor on call found, under a gate's message ('' without a diagnosis)
function diagnosisText(diagnosis) {
  if (!diagnosis) return '';
  return `\n\n---\nSupervisor on call${diagnosis.note ? ` (${diagnosis.note})` : ''}: ${diagnosis.explanation}`
    + `${diagnosis.recommendation ? `\nRecommendation${diagnosis.recommend ? ` (${diagnosis.recommend})` : ''}: ${diagnosis.recommendation}` : ''}`
    + `${diagnosis.options?.length ? `\nOptions:\n${diagnosis.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : ''}`
    + `${diagnosis.user_action ? `\nAction only you can take: ${diagnosis.user_action}` : ''}`;
}

const methods = {
  // A gate with `check:` (approve_merge): the PR/MR is checked right before the gate opens (its
  // message shows `check`), and again each time another run merges into the same repository while
  // it is open. With `check.on_fail`, a PR/MR that is not mergeable never reaches the person: the
  // gate is not opened (or is withdrawn) and the run takes the recovery route (recoverFromActionError).
  // A check that could not run (`error`) opens the gate anyway; the approved merge checks again.
  // Resolves to the approval ({ answer, feedback }) or { recover: <next step> }.
  async openGate(step, t0, diagnosis = null) {
    const c = step.check;
    if (!c) return this.requestApproval(step, diagnosis);
    const failed = (r) => !!c.on_fail && !['passed', 'error'].includes(r.state);
    const first = await this.runCheck(c, step, 'check', this.ctx);
    if (failed(first)) return { recover: await this.gateCheckFailed(step, first, t0) };
    const pending = this.requestApproval(step, diagnosis);
    const id = `a${this.nApproval}`;
    const key = this.mergeKey(c, this.ctx);
    const off = mergeQueue.onMerged(async (m) => {
      if (m.runId === this.runId || m.key !== key || !this.approvals.has(id)) return;
      try {
        const again = await this.runCheck(c, step, 'check', this.ctx);
        if (failed(again)) this.withdrawApproval(id, again);
      } catch (e) {
        this.emitEvent('log', { level: 'warn', message: `${step.id}: could not check the PR/MR again after another merge: ${e.message}` });
      }
    });
    try {
      const res = await pending;
      return res.withdrawn ? { recover: await this.gateCheckFailed(step, res.withdrawn, t0) } : res;
    } finally {
      off();
    }
  },

  async gateCheckFailed(step, check, t0) {
    const st = this.ctx.steps[step.id];
    st.output = { check, opened: false };
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output: st.output, duration_ms: Date.now() - t0, error: true });
    const e = Object.assign(new Error(`${check.target} cannot be merged (${check.state}): ${check.detail}. The approval was not asked.`), { check });
    return this.recoverFromActionError(step, { on_error: step.check.on_fail, recover: step.check.recover }, e);
  },

  // An open gate whose PR/MR stopped being mergeable (another run merged): nobody approves it.
  withdrawApproval(id, check) {
    const a = this.approvals.get(id);
    if (!a) return;
    this.approvals.delete(id);
    this.syncGateClock();
    this.emitEvent('approval.resolved', { approval_id: id, withdrawn: true, by: 'check', reason: `${check.state}: ${check.detail}` });
    this.setStatus(this.orchestrator, 'active');
    a.resolve({ withdrawn: check });
  },

  // Resolves to { answer, feedback }. `feedback: true | { label, placeholder }` on the step asks the
  // UI for an optional free text next to the choices; it is the gate's `output.feedback`, and every
  // non-empty one is appended to the run-wide `feedback` list the next prompts can include.
  // A choice with `feedback_required: true` is refused without a text (resolveApproval returns false).
  // `local_preview: true` on the step offers Run locally (the service runs the worktree, see
  // packages/engine/domains/local/local-preview.js); it never answers the gate. `diff_base: <ref>` offers Show the diff (the
  // worktree's changes since that ref, in an embedded terminal).
  // diagnosis: the supervisor on call could not solve the problem of an escalation gate
  // ({ explanation, recommendation, user_action, note }): it goes under the message and in `supervisor`.
  /** @param {{ explanation?: string, recommend?: string | null, recommendation?: string | null, options?: string[] | null, user_action?: string | null, note?: string } | null} [diagnosis] */
  requestApproval(step, diagnosis = null) {
    // #368: a run pausing after its current turn asks nothing more (a gate is never answered by a pause)
    if (this.pausing) return Promise.reject(pausedError());
    const id = `a${++this.nApproval}`;
    let message = (step.raw ? String(step.message).trim() : render(step.message, this.ctx).trim()) + diagnosisText(diagnosis);
    // `report:` (#290): a Markdown document (e.g. the release summary) that leads the message; the
    // screens render it apart (the event's `report`), '' leaves the message as it is
    const report = this.gateText(step, step.report);
    if (report) message = `${report}\n\n${message}`;
    const choices = step.choices ? step.choices.map((c) => ({
      id: c.id,
      label: render(c.label, this.ctx),
      // #30: the catalog key the screens translate the label with (the YAML label stays the English fallback)
      ...(c.label_key ? { label_key: String(c.label_key) } : {}),
      ...(c.help_key ? { help_key: String(c.help_key) } : {}), // #36: the help's key, as label_key
      ...(c.feedback_required ? { feedback_required: true } : {}),
      ...(c.help ? { help: this.gateText(step, c.help) } : {}),
    })) : null;
    // an Approve / Reject gate: what its buttons say and do (#213)
    const yesNo = step.choices ? null : {
      approve: { label: this.gateText(step, step.approve_label) || 'Approve', help: this.gateText(step, step.approve_help) },
      reject: { label: this.gateText(step, step.reject_label) || 'Reject', help: this.gateText(step, step.reject_help) },
    };
    const brief = gateSummary.gateBrief({
      message,
      summary: this.gateText(step, step.summary),
      recommend: this.gateText(step, step.recommend),
      diagnosis,
      // a gate with choices has no yes/no buttons
      answers: yesNo ? [{ id: 'approve', label: yesNo.approve.label }, { id: 'reject', label: yesNo.reject.label }] : /** @type {object[]} */ (choices),
    });
    const fb = step.feedback === true ? {} : step.feedback || null;
    const feedback = fb && { label: render(fb.label || 'Anything to add? (optional)', this.ctx), placeholder: render(fb.placeholder || '', this.ctx) };
    const requestedAt = new Date().toISOString();
    const timeout = parseDuration(step.timeout, null);
    // the folder the run's work is in (its worktree; a simulation works in the repository folder)
    const workDir = this.ctx.worktree_dir || this.inputs.repo_path || null;
    // #30: `environment: <step>`: that check step's environment failure ({ reason, dir }), for the
    // screens to say it in the interface language
    const environment = step.environment ? this.ctx.steps?.[step.environment]?.output?.environment : null;
    const extra = {
      ...(environment ? { environment } : {}),
      brief,
      ...yesNo,
      ...(report ? { report } : {}),
      ...(workDir ? { work_dir: workDir } : {}),
      // run_app: the gate offers Run App even without a config (its setup saves the project's, #108)
      ...(step.local_preview && workDir ? { run_app: true } : {}),
      ...(step.local_preview && this.localPreview && workDir ? { local_preview: this.localPreview } : {}),
      ...(step.diff_base && workDir ? { diff_base: render(step.diff_base, this.ctx).trim() } : {}),
      ...(diagnosis ? { supervisor: diagnosis } : {}),
      // save_to_issue: <choice> (#125): a run about an issue also offers "<choice> and save to issue #n";
      // the answer is that choice (transitions unchanged) with intent save_to_issue
      ...(step.save_to_issue && this.issues?.[0] ? { save_to_issue: { choice: step.save_to_issue, issue: this.issues[0] } } : {}),
      // #567: an agent's own question (agentQuestion): who asks, and a decision only the owner takes
      // and its default, the choice --auto-approve answers
      // #647: a human_edit gate also takes the person's edit requests (requestEdit), for this agent
      ...(step.type === 'human_edit' ? { edit: { agent: step.agent } } : {}),
      ...(step.by === 'agent' ? { by: 'agent', agent: step.agent, kind: 'decision', ...(step.default ? { default: step.default } : {}) } : {}),
    };

    // registered before its event, so runs:active lists it as soon as anyone hears of it
    const answered = new Promise((resolve, reject) => {
      const onTimeout = step.choices ? step.choices[step.choices.length - 1].id : false;
      const timer = timeout ? setTimeout(() => this.resolveApproval(id, onTimeout, 'timeout'), timeout) : undefined;
      this.approvals.set(id, {
        stepId: step.id,
        // what pendingGates() hands the UI, so a reloaded window rebuilds the gate without its event
        gate: { approval_id: id, step_id: step.id, message, choices, feedback, ...extra, requested_at: requestedAt },
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.syncGateClock();
    });
    this.emitEvent('approval.requested', { approval_id: id, step_id: step.id, message, choices, feedback, ...extra });
    if (this.approvals.has(id)) this.setStatus(this.orchestrator, 'waiting'); // not answered by a listener already
    return answered;
  },

  // #567: an agent step with `ask_human: true` whose answer has `needs_human.question` (12-Factor
  // Agents, factor 7). The visit ends (its output kept for the templates, no transition) and the run
  // waits at a gate of the step with the question; the answer goes to the agent's next turn as
  // `human_answer` and the step runs again. Its transitions run only after the answering turn. The
  // gate is the owner's (kind decision): only a second question in a row wakes the supervisor on
  // call (superviseQuestion), which may give the agent its own default. Returns the step to run
  // (the same one) or null: no question, the run goes on as usual. Without the opt-in the field is
  // an ordinary one, with a warning.
  async agentQuestion(step, st, output, t0) {
    const q = !step.agents && output && typeof output === 'object' ? output.needs_human : null;
    if (!q || typeof q !== 'object' || !String(q.question || '').trim()) { st.asks = 0; return null; }
    if (!step.ask_human) {
      st.asks = 0;
      this.emitEvent('log', { level: 'warn', step_id: step.id, message: `${step.id}: the answer has needs_human, but the step does not set ask_human: true; it is an ordinary field, no gate opens.` });
      return null;
    }
    this.emitEvent('step.finished', { step_id: step.id, visit: st.visits, iteration: st.iteration, output, duration_ms: Date.now() - t0, needs_human: true });
    st.asks = (st.asks || 0) + 1;
    const answer = (await this.superviseQuestion(step, st, q)) || await this.askHuman(step, q);
    st.humanAnswer = answer;
    this.emitEvent('step.transition', { from: step.id, to: step.id, when: answer.by === 'supervisor' ? 'needs_human: supervisor on call' : 'needs_human' });
    return step.id;
  },

  // The gate of an agent's question: its options as choices (an answer box alone without any), free
  // text, the agent's default under the message. Resolves to the human_answer of the next turn.
  async askHuman(step, q) {
    const options = (Array.isArray(q.options) ? q.options : [])
      .filter((o) => o && String(o.id ?? '').trim())
      .map((o) => ({ id: String(o.id), label: String(o.label || o.id) }));
    const choices = options.length ? options : [{ id: 'answer', label: 'Send my answer' }];
    const def = q.default != null ? String(q.default) : null;
    const defLabel = def && options.find((o) => o.id === def)?.label;
    const agent = this.displayNames().agents[step.agent] || step.agent;
    const { answer, feedback } = await this.requestApproval({
      id: step.id, raw: true, by: 'agent', agent: step.agent, default: choices.some((c) => c.id === def) ? def : null,
      message: `${agent} asks: ${String(q.question).trim()}${def ? `\n\nIts default: ${defLabel ? `${defLabel} (${def})` : def}` : ''}`,
      choices, feedback: { label: options.length ? 'Your answer or more context (optional)' : 'Your answer' },
    });
    // a yes/no answer (an auto-approve): yes takes the agent's default
    const choice = typeof answer === 'boolean' ? (answer ? def : null) : answer;
    return {
      question: String(q.question).trim(), choice, label: options.find((o) => o.id === choice)?.label || null,
      feedback: feedback || '', default: def, by: 'owner',
    };
  },

  // What the agent's next turn is told of the answer (consumed by runAgentStep)
  humanAnswerNote(a) {
    const pick = a.choice ? `${a.choice}${a.label ? ` (${a.label})` : ''}` : '(no option chosen)';
    if (a.by === 'supervisor') {
      return `\n\n---\nYou asked "${a.question}" again. The supervisor on call answered for the owner with your own default: ${pick}. Go on with it${a.feedback ? `\n${a.feedback}` : ''}`;
    }
    return `\n\n---\nThe owner answered your question "${a.question}": ${pick}${a.feedback ? `\n${a.feedback}` : ''}`;
  },

  // A gate's summary template (#213), rendered and trimmed: '' when the step has none, is engine-made
  // (raw) or the template fails (logged): the gate opens with its message whatever the summary does.
  gateText(step, text) {
    if (!text || step.raw) return '';
    try { return render(text, this.ctx).trim(); } catch (e) {
      this.emitEvent('log', { level: 'warn', message: `Gate ${step.id}: its summary could not be rendered (${e.message}); the gate shows its message.` });
      return '';
    }
  },

  // The gates this run waits at, as the approval.requested events described them (plus requested_at).
  // The service lists them in runs:active: the UI never relies only on the events it saw live.
  pendingGates() {
    return [...this.approvals.values()].map((a) => a.gate).filter(Boolean);
  },

  // #647: the person's edit request at an open `type: human_edit` gate: one turn of the step's agent
  // (its session, so a persistent writer keeps the document in mind) with the text in its prompt.
  // The gate stays open: only resolveApproval ends the step. Resolves to the turn's result
  // ({ text, ... }); with the step's `output_schema` (the answer of each request), its parsed `output`
  // too. Refuses an unknown gate or a gate of another step type.
  async requestEdit(id, text, opts = {}) {
    const a = this.approvals.get(id);
    const step = a && this.wf.steps.find((s) => s.id === a.stepId);
    if (!step || step.type !== 'human_edit') throw new Error(`No open human_edit gate ${id}.`);
    const request = String(text ?? '').trim();
    if (!request) throw new Error('An edit request needs a text.');
    const message = String(a.gate?.message || '').trim();
    const schema = step.output_schema || null;
    let prompt = `${message ? `${message}\n\n` : ''}The owner asks for a change:\n\n${request}`;
    if (schema) {
      prompt += '\n\n---\nAt the end of your response you MUST include a ```json block with an object that validates against this JSON Schema:\n```json\n'
        + `${JSON.stringify(schema, null, 2)}\n\`\`\``;
    }
    const attachments = this.copyAttachments(checkAttachments(opts.images || []), `${step.id}-request`);
    this.editRequests = (this.editRequests || 0) + 1;
    const hint = { stepId: step.id, visit: this.editRequests, schema, agent: step.agent, sequences: this.mockSequences };
    const res = await this.sendToAgent(step.agent, prompt, { stepId: step.id, hint, attachments });
    if (!schema) return res;
    const output = extractJson(res.text);
    const errors = validateSchema(output, schema);
    if (errors.length) throw new Error(`${step.agent}'s answer to the edit request does not match the step's output_schema: ${errors.join('; ')}`);
    return { ...res, output };
  },

  // answer: boolean (approve/reject) or the id of one of the step's choices; feedback: optional text;
  // intent: 'save_to_issue' with the gate's save_to_issue choice (#125), recorded on the answer
  // images: pictures attached to the feedback (#129), checked (an error names the file and the limit),
  // copied into <run_dir>/attachments/<gate>-feedback/ and given to the next agent step. They never
  // decide anything: the answer is the owner's choice.
  // answeredBy: who answered and from where, recorded on the event (#226, the phone gates page:
  // { answered_by: 'owner', via: 'mobile', device })
  resolveApproval(id, answer, by = 'user', feedback = '', intent = null, images = [], answeredBy = null) {
    const a = this.approvals.get(id);
    if (!a) return false;
    const text = String(feedback ?? '').trim();
    if (!text && a.gate?.choices?.find((c) => c.id === answer)?.feedback_required) return false;
    // copied before the approval is taken: a failed copy throws and leaves the gate open to answer again
    // #416: over a limit when the owner answers (e.g. the cost), the run stops at the gate before
    // taking the answer: no approval.resolved, so Resume asks it again once the limit is raised.
    // Returns true: the answer was received, the run ends with the reason.
    try {
      this.checkLimits();
    } catch (e) {
      this.approvals.delete(id);
      this.syncGateClock();
      this.setStatus(this.orchestrator, 'active');
      a.reject(e);
      return true;
    }
    const stored = this.copyAttachments(checkAttachments(images), `${a.stepId}-feedback`);
    this.approvals.delete(id);
    this.syncGateClock();
    if (stored.length) this.gateImages = stored;
    const waitMs = Math.max(0, Date.now() - Date.parse(a.gate?.requested_at || Date.now()));
    const w = (this.gateWaits[a.stepId] ??= { waits: 0, wait_ms: 0 });
    w.waits++;
    w.wait_ms += waitMs;
    const data = typeof answer === 'boolean' ? { approved: answer } : { choice: answer };
    if (intent === 'save_to_issue' && a.gate?.save_to_issue?.choice === answer) data.intent = intent;
    // the commit the owner decided on (#112): a resume may only pass this gate again while the branch is still there
    const commit = this.worktreeHead();
    this.emitEvent('approval.resolved', { approval_id: id, step_id: a.stepId, ...data, by, ...(answeredBy || {}), wait_ms: waitMs, ...(commit ? { commit } : {}), ...(text ? { feedback: text } : {}), ...(stored.length ? { attachments: stored } : {}) });
    if (text) this.ctx.feedback.push({ step: a.stepId, choice: typeof answer === 'boolean' ? String(answer) : answer, text, ts: new Date().toISOString(), ...(stored.length ? { images: stored } : {}) });
    this.setStatus(this.orchestrator, 'active');
    a.resolve({ answer, feedback: text, by });
    return true;
  },
};

module.exports = {
  methods,
};
