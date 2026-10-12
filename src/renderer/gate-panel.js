/* global api */
// The gate panel every run screen shares (#108, #115, #119): the Run screen's gate cards
// (views/run/), the run chat (views/runchat/) and Write & Review (views/duo/). A gate's choices
// (gateChoices), every gate's summary card (gateCardHtml, gateButtonsHelpHtml, confirmGateAnswer:
// #213), the developer's brief instead of the long message (gateBriefHtml) with the test
// writer's E2E scenarios for the Dev/QA (gateScenariosHtml, mountGateScenarios, #143), the Artifacts
// side panel of a gate that tries the change (gateSideHtml, mountGateSides) and the gate's tools
// (gateToolsHtml, onGateTool): Run App with its one-click confirmation and its fields, the
// terminal toggle, Show the diff (the diff viewer, diff-viewer.js, #118) and the worktree's folder
// and shell; paintGateApps keeps Run App's state on every gate shown. Uses app.js globals ($, esc,
// state, api, errMsg, showToast), openTerminal (term-dock.js) and DiffViewer.

// The gates that try the change (`local_preview: true` on the step) get Run App and the side panel.
const gateTriesChange = (g) => !!(g.run_app || g.runApp || g.local_preview || g.localPreview) && !!(g.work_dir || g.workDir);

// The right column of such a gate: an Artifacts panel (artifacts-panel.js) mounted by mountGateSides.
function gateSideHtml(g, runId = g.run_id) {
  if (!gateTriesChange(g)) return '';
  return `<aside class="run-gate-side" data-gate-side="${esc(g.approval_id || g.approvalId)}" data-run="${esc(runId || '')}" data-diff="${g.diff_base || g.diffBase ? '1' : ''}"></aside>`;
}

// The latest step output of a live run that matches (the developer's: summary, issues, test_notes…).
function lastOutput(runId, match) {
  const evs = state.runs.get(runId)?.events || [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const o = evs[i].type === 'step.finished' ? evs[i].output : null;
    if (o && typeof o === 'object' && match(o)) return o;
  }
  return null;
}

// The output of a `type: screenshots` step (#144) when it is the last step that ran before the
// gate (gates' own answers skipped): { folder, round, taken, errors, reason, message }, else null.
function lastCapture(runId) {
  const evs = state.runs.get(runId)?.events || [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const o = evs[i].type === 'step.finished' ? evs[i].output : null;
    if (!o || typeof o !== 'object' || 'approved' in o || 'choice' in o) continue;
    return o.kind === 'screenshots' ? o : null;
  }
  return null;
}

// Mounts the Artifacts panel of every gate side in root: the run's files newest first, and at a
// gate with diff_base the changed files (each opens the diff viewer at that file) and the developer's notes. Right
// after a screenshots step (developer_check), that step's latest round leads the panel.
function mountGateSides(root) {
  mountGateScenarios(root);
  if (!window.ArtifactsPanel) return;
  root.querySelectorAll('[data-gate-side]').forEach((el) => {
    if (el.classList.contains('ap')) return; // already mounted
    const { gateSide: approval, run: runId, diff } = el.dataset;
    const dev = lastOutput(runId, (o) => o.test_notes || o.evidence_plan);
    const notes = [['Test notes', dev?.test_notes], ['Evidence plan', dev?.evidence_plan]]
      .filter(([, t]) => t).map(([title, t]) => ({ title, text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }));
    const onChange = (file) => DiffViewer.open({ runId, approvalId: approval, file });
    const panel = ArtifactsPanel.mount(el, { runId, flat: true, extras: { notes, changes: diff ? 'Loading…' : null, onChange, capture: lastCapture(runId) } });
    if (diff) {
      // the files the developer reported: a simulated run's only changes (#115), whatever git says
      // of its folder, and a real run's fallback when its worktree cannot be listed
      const reported = (lastOutput(runId, (o) => Array.isArray(o.files_changed))?.files_changed || [])
        .map((f) => String(typeof f === 'object' && f ? f.file || f.path || '' : f)).filter(Boolean);
      const simulated = !!state.runs.get(runId)?.run?.mock;
      const showReported = () => panel.setExtras({ ...panel.extras, changes: reported.map((file) => ({ file, added: null, deleted: null })), changesReported: simulated ? 'simulated' : 'reported' });
      if (simulated) showReported(); // even empty: git's diff of the folder is not the simulation's
      else {
        Promise.resolve(api.gateChanges(runId, approval))
          .then((list) => panel.setExtras({ ...panel.extras, changes: list || [] }))
          .catch((e) => (reported.length ? showReported() : panel.setExtras({ ...panel.extras, changes: `Could not list them: ${errMsg(e)}` })));
      }
    }
  });
}
window.mountGateSides = mountGateSides;

// A short list instead of the gate's long message (#108): the developer's summary in one sentence
// and one line per issue (done / not done + one sentence), the full message expandable.
// fullHtml: the message as the screen shows it. '' when there is no such output to summarise.
function gateBriefHtml(runId, g, fullHtml) {
  if (!gateTriesChange(g)) return '';
  const out = lastOutput(runId, (o) => Array.isArray(o.issues) || (o.summary && o.files_changed));
  const scenarios = gateScenariosHtml(runId, g);
  if (!out && !scenarios) return '';
  const first = (s) => String(s || '').trim().split(/(?<=[.!?])\s+|\n/)[0];
  const ref = (u) => { const m = /\/(?:issues|pull|merge_requests)\/(\d+)/.exec(String(u)); return m ? `#${m[1]}` : String(u); };
  const issues = (out?.issues || []).map((i) => `<li class="${i.done ? 'ok' : 'not'}"><span class="gate-issue-state">${i.done ? '✔ done' : '✖ not done'}</span>
    <b title="${esc(i.issue)}">${esc(ref(i.issue))}</b> ${esc(first(i.summary))}</li>`).join('');
  return `<div class="run-gate-brief">${out?.summary ? `<p>${esc(first(out.summary))}</p>` : ''}${issues ? `<ul class="gate-issues">${issues}</ul>` : ''}${scenarios}
    <details class="run-gate-full"><summary class="small">Full message</summary>${fullHtml}</details></div>`;
}
window.gateBriefHtml = gateBriefHtml;

// A gate's answers as buttons say them (#213): an Approve / Reject gate's labels and help
// (`approve` / `reject` on the gate), else its choices; `key` is what a recommendation names
// (approve, reject or the choice id).
function gateAnswers(g) {
  if (g.approve || g.reject || !g.choices) {
    return [
      { id: true, key: 'approve', label: g.approve?.label || 'Approve', help: g.approve?.help || '' },
      { id: false, key: 'reject', label: g.reject?.label || 'Reject', help: g.reject?.help || '' },
    ];
  }
  return g.choices.map((c) => ({ ...c, key: String(c.id), help: c.help || '' }));
}

// The summary every human gate shows first (#213), in the run chat and on the Run screen: what
// happened, the status per issue (Markdown), the recommendation (the supervisor's or the
// workflow's), the supervisor's options and an action only the person can take; a gate that tries
// the change keeps its E2E scenarios; the long message (with the supervisor's full note) is
// collapsed in Details. A gate of a run from before #213 (no `brief`) gets gateBriefHtml or ''.
// g: the gate record, its event or a run chat gate (brief); fullHtml: the message as the screen shows it.
function gateCardHtml(runId, g, fullHtml) {
  const b = g.brief;
  if (!b?.headline) return gateBriefHtml(runId, g, fullHtml);
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const rec = b.recommendation;
  const recHtml = rec && (rec.label || rec.reason) ? `<p class="gate-card-rec"><b>Recommended${rec.source === 'supervisor' ? ' by the supervisor' : ''}:</b>
    ${rec.label ? `<b>${esc(rec.label)}</b>${rec.reason ? '. ' : ''}` : ''}${esc(rec.reason || '')}</p>` : '';
  const options = b.options?.length ? `<ol class="gate-card-options small">${b.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : '';
  const action = b.user_action ? `<p class="gate-card-action small"><b>Only you can do this:</b> ${esc(b.user_action)}</p>` : '';
  const scenarios = gateTriesChange(g) ? gateScenariosHtml(runId, g) : '';
  return `<div class="gate-card"><p class="gate-card-what">${esc(b.headline)}</p>${b.body ? `<div class="gate-card-status md">${md(b.body)}</div>` : ''}${recHtml}${options}${action}${scenarios}
    <details class="run-gate-full"><summary class="small">Details</summary>${fullHtml}</details></div>`;
}
window.gateCardHtml = gateCardHtml;

// A gate's report (#290: the release run's summary at its Ship gate), which the engine puts first in
// the message: rendered as Markdown on its own, then the rest of the message.
// g: the gate record, its event or a run chat gate (report, message) → { reportHtml, message }
function gateReportParts(g) {
  const message = String(g.message || '');
  const report = String(g.report || '');
  if (!report) return { reportHtml: '', message };
  const html = typeof markdownHtml === 'function' ? markdownHtml(report) : `<pre>${esc(report)}</pre>`;
  return {
    // the only gate report today is the release summary: its test id names it
    reportHtml: `<div class="gate-report md" data-testid="release-summary">${html}</div>`,
    message: message.startsWith(report) ? message.slice(report.length).trim() : message,
  };
}
window.gateReportParts = gateReportParts;

// What each button does (#213), under the buttons: one line per answer that has a help text.
function gateButtonsHelpHtml(g) {
  const rows = gateAnswers(g).filter((a) => a.help);
  return rows.length ? `<ul class="gate-card-buttons muted small">${rows.map((a) => `<li><b>${esc(a.label)}</b>: ${esc(a.help)}</li>`).join('')}</ul>` : '';
}
window.gateButtonsHelpHtml = gateButtonsHelpHtml;

// The answer clicked against the gate's recommendation (#213): the opposite one asks once
// ("The supervisor recommends Stop the run. Merge anyway?"); resolves true to send it.
// answer: true / false (Approve / Reject) or a choice id. gateAgainstRecommendation says, without
// waiting, whether it asks: the screens send any other answer at once, as before.
const answerKey = (answer) => (answer === true || answer === 'true' ? 'approve' : answer === false || answer === 'false' ? 'reject' : String(answer));
function gateAgainstRecommendation(g, answer) {
  const rec = g?.brief?.recommendation;
  return !!rec?.answer && answerKey(answer) !== rec.answer;
}
window.gateAgainstRecommendation = gateAgainstRecommendation;
async function confirmGateAnswer(g, answer) {
  if (!gateAgainstRecommendation(g, answer)) return true;
  const rec = g.brief.recommendation;
  const key = answerKey(answer);
  const clicked = gateAnswers(g).find((a) => a.key === key)?.label || key;
  const who = rec.source === 'supervisor' ? 'The supervisor' : 'The workflow';
  return confirmDialog(`${clicked}?`, `${who} recommends ${rec.label || rec.answer}${rec.reason ? `: ${rec.reason}` : '.'} ${clicked} anyway?`, clicked);
}
window.confirmGateAnswer = confirmGateAnswer;

// The test writer's E2E scenarios (#143), for the Dev/QA at a gate that tries the change: the
// counts, then one row per scenario (status pill, name, the reason of a failed or skipped one),
// each expanding to its Given/When/Then and its screenshots (read by mountGateScenarios). Before
// the test step ran (developer_check's first visits) it says when they come. '' when no step
// output has `scenarios` and the gate's message does not mention them (a workflow without E2E).
const SCENARIO_PILL = { passed: 'pill-success', failed: 'pill-failed', skipped: 'pill-cancelled', pending: 'pill-idle' };
// pending (#199): written and checked by the run, run at release by the E2E release workflow
const SCENARIO_LABEL = { pending: 'written, run at release' };
function gateScenariosHtml(runId, g = {}) {
  const out = lastOutput(runId, (o) => Array.isArray(o.scenarios));
  const head = (extra) => `<div class="gate-scenarios-head"><b>E2E scenarios</b> <span class="muted small">for the Dev/QA</span>${extra}</div>`;
  if (!out) {
    const expected = /E2E scenarios/.test(String(g.message || ''));
    return expected ?`<div class="gate-scenarios">${head('')}<p class="muted small">None yet: the test writer writes them after the code review (they run at release).</p></div>` : '';
  }
  const list = out.scenarios.filter((s) => s && typeof s === 'object' && s.name);
  const note = out.e2e_note ? `<p class="muted small gate-scenarios-note" title="${esc(out.e2e_note)}">${esc(out.e2e_note)}</p>` : '';
  if (!list.length) return `<div class="gate-scenarios">${head('')}<p class="muted small">No scenario for this change.</p>${note}</div>`;
  const count = (k) => list.filter((s) => s.status === k).length;
  const counts = Object.keys(SCENARIO_PILL).filter(count).map((k) => `<span class="pill ${SCENARIO_PILL[k]}">${count(k)} ${SCENARIO_LABEL[k] || k}</span>`).join(' ');
  const runDir = state.runs.get(runId)?.events?.find((e) => e.type === 'workflow.started')?.run_dir || '';
  const file = (p) => (/^([a-zA-Z]:)?[\\/]/.test(p) || !runDir ? p : `${runDir.replace(/[\\/]+$/, '')}/${p}`);
  const step = (t) => {
    const m = /^(Given|When|Then|And|But)\b\s*(.*)$/i.exec(String(t).trim());
    return `<li>${m ? `<b>${esc(m[1])}</b> ${esc(m[2])}` : esc(t)}</li>`;
  };
  const rows = list.map((s) => {
    const status = SCENARIO_PILL[s.status] ? s.status : 'skipped';
    const shots = (Array.isArray(s.screenshots) ? s.screenshots : []).map((p) => String(typeof p === 'object' && p ? p.path : p || '')).filter(Boolean);
    const imgs = shots.length ? `<div class="gate-scenario-shots">${shots.map((p) => `<img ${window.ImageViewer?.THUMB || 'tabindex="0"'} alt="${esc(`${s.name}: ${p.split('/').pop()}`)}" data-gate-shot="${esc(file(p))}" data-gate-scenario="${esc(s.name)}" />`).join('')}</div>` : '';
    const key = `${runId}\n${s.feature || ''}\n${s.name}`;
    return `<details class="gate-scenario st-${status}" data-scenario-key="${esc(key)}"${openScenarios.has(key) ? ' open' : ''}><summary><span class="pill ${SCENARIO_PILL[status]}">${SCENARIO_LABEL[status] || status}</span>
      <span class="gate-scenario-name" title="${esc(s.feature ? `${s.name} (${s.feature})` : s.name)}">${esc(s.name)}</span>${s.reason ? `<span class="muted small gate-scenario-reason" title="${esc(s.reason)}">${esc(s.reason)}</span>` : ''}${shots.length ? `<span class="badge">${shots.length} screenshot${shots.length === 1 ? '' : 's'}</span>` : ''}</summary>
      <ol class="gate-scenario-steps">${(s.steps || []).map(step).join('')}</ol>${s.feature ? `<div class="muted small" title="${esc(s.feature)}">${esc(s.feature)}</div>` : ''}${imgs}</details>`;
  }).join('');
  return `<div class="gate-scenarios">${head(` ${counts}`)}${rows}${note}</div>`;
}
// also the run's summary (views/run/), where a workflow without a merge approval shows them
window.gateScenariosHtml = gateScenariosHtml;

// The scenarios' screenshots in root (gateScenariosHtml): read once found (artifacts:read), each
// opening the image viewer with the other screenshots of its scenario; a missing file says so.
const scenarioShots = new Map(); // file -> data URL
const openScenarios = new Set(); // the expanded ones (data-scenario-key), kept when a gate is drawn again
function mountGateScenarios(root) {
  root.querySelectorAll('details[data-scenario-key]').forEach((d) => {
    d.ontoggle = () => (d.open ? openScenarios.add(d.dataset.scenarioKey) : openScenarios.delete(d.dataset.scenarioKey));
  });
  root.querySelectorAll('img[data-gate-shot]').forEach(async (img) => {
    const box = img.closest('.gate-scenario-shots');
    if (box && !box.onclick) {
      const open = (el) => {
        const all = [...box.querySelectorAll('img[data-gate-shot]')];
        // every screenshot of the scenario, one item each (#182)
        const title = `Scenario: ${el.dataset.gateScenario}`;
        ImageViewer.open({ title, items: all.map((i) => ({ title, images: [{ file: i.dataset.gateShot, src: i.getAttribute('src') || undefined, label: i.alt }] })), index: all.indexOf(el) });
      };
      box.onclick = (e) => { const el = e.target.closest('img[data-gate-shot]'); if (el) open(el); };
      box.onkeydown = (e) => { const el = e.target.closest('img[data-gate-shot]'); if (el && e.key === 'Enter') open(el); };
    }
    if (img.getAttribute('src')) return;
    let src = scenarioShots.get(img.dataset.gateShot);
    if (!src) {
      try { src = (await api.readArtifact(img.dataset.gateShot))?.image || null; } catch { src = null; }
      if (src) scenarioShots.set(img.dataset.gateShot, src);
    }
    // a missing file: the image stays hidden (a later mount retries it) behind a line that says so
    const missing = img.nextElementSibling?.classList.contains('gate-scenario-missing') ? img.nextElementSibling : null;
    img.hidden = !src;
    if (src) { img.src = src; missing?.remove(); } else if (!missing) {
      img.after(Object.assign(document.createElement('span'), { className: 'muted small gate-scenario-missing', textContent: `Screenshot not found: ${img.dataset.gateShot.split(/[\\/]/).pop()}`, title: img.dataset.gateShot }));
    }
  });
}
window.mountGateScenarios = mountGateScenarios;

// A gate's choices (Run screen, run chat, Write & Review chat). A gate with save_to_issue in a run
// about an issue (#125) also offers "Accept and save to issue #n", right after the choice it
// answers: the same choice with intent save_to_issue (the Save to issue preview opens when the run ends).
function gateChoices(gate) {
  const choices = gate.choices || [{ id: true, label: gate.approve?.label || 'Approve' }, { id: false, label: gate.reject?.label || 'Reject' }];
  const save = gate.save_to_issue;
  const at = save?.issue ? choices.findIndex((c) => String(c.id) === String(save.choice)) : -1;
  if (at < 0) return choices;
  const extra = {
    id: save.choice, intent: 'save_to_issue', label: `Accept and save to issue #${save.issue.number}`,
    title: `Accepts the document, then previews the change to issue #${save.issue.number} when the run ends: nothing is sent before you confirm`,
  };
  return [...choices.slice(0, at + 1), extra, ...choices.slice(at + 1)];
}

// What a gate offers besides its answers (Run screen and run chat); none of them answers it:
// Run locally (#70: `local_preview` on the gate, the project's or workflow's command in the run's
// worktree, stopped when the gate is answered), the worktree's folder, a terminal there and its diff
// (`diff_base` on the gate).
// g: the approval.requested event (local_preview, run_app, work_dir, diff_base) or a run chat gate (localPreview, runApp, workDir, diffBase).
// Run App (#108) shows on every gate with `local_preview: true`, configured or not: without a
// config it opens a setup prefilled from the worktree. Its state (running / stopped / failed),
// Stop, the terminal toggle and Open URL are painted by paintGateApps from the run's events.
function gateToolsHtml(g, { disabled = false, runId = g.run_id || g.runId || '' } = {}) {
  const lp = g.local_preview || g.localPreview || null;
  const dir = g.work_dir || g.workDir || null;
  const base = dir ? g.diff_base || g.diffBase || null : null;
  if (!lp && !dir) return '';
  const off = disabled ? ' disabled' : '';
  const how = lp ? `${lp.install ? `${lp.install} (when dependencies are missing or the lockfile changed), then ` : ''}${lp.command}` : '';
  const runApp = !!lp || (!!(g.run_app || g.runApp) && !!dir);
  const run = runApp ? `<button type="button" class="btn sm" data-gate-tool="preview" title="${esc(lp ? `${how} in ${dir}. Runs in simulation only, on a scratch copy of your workspace.` : 'Asks once: the command the repository declares (.multiagent/local-preview.yaml) or one detected from the worktree, saved as the project\'s Local preview.')}"${off}>${esc(runAppLabel(lp))}</button>
    <span class="gate-app-state" data-gate-app-state></span>
    <button type="button" class="btn sm ghost hidden" data-gate-tool="stop" title="Stop this run's app"${off}>■ Stop</button>
    <button type="button" class="btn sm ghost hidden" data-gate-tool="app-term" title="Show or hide the app's terminal"${off}>Terminal</button>
    <a class="small${lp?.url ? '' : ' hidden'}" data-gate-app-url href="${esc(lp?.url || '#')}" target="_blank" rel="noopener">Open ${esc(lp?.url || 'URL')}</a>
    <label class="muted small" title="The copy uses your real workspace (projects, runs, settings) instead of a scratch copy. Still simulation only."><input type="checkbox" data-gate-real${off}> real workspace</label>` : '';
  const open = dir ? `<button type="button" class="btn sm ghost" data-gate-tool="folder" title="${esc(dir)}"${off}>Open the worktree</button>
    <button type="button" class="btn sm ghost" data-gate-tool="shell" title="A terminal in ${esc(dir)}"${off}>Terminal there</button>` : '';
  const diff = base ? `<button type="button" class="btn sm ghost" data-gate-tool="diff" title="${esc(`Review the branch's changes since ${base} file by file, split or unified (git diff ${base}...HEAD in the worktree)`)}"${off}>Show the diff</button>` : '';
  const more = runApp ? '<div class="gate-app-error error small hidden" data-gate-app-error></div><div class="gate-app-setup hidden" data-gate-setup></div>' : '';
  return `<div class="row gate-tools" data-dir="${esc(dir || '')}" data-approval="${esc(g.approval_id || g.approvalId)}" data-run="${esc(runId)}">${run}${diff}${open}${more}</div>`;
}

const runAppLabel = (lp) => (lp?.command ? `▶ Run App: ${lp.command}` : '▶ Run App…');

// Run App's state on every gate shown (Run screen, run chat): the run view's `preview`, kept from
// local_preview.started / .stopped and from a start that failed (e.g. the port already in use).
function paintGateApps() {
  document.querySelectorAll('.gate-tools[data-run]').forEach((box) => {
    const st = box.querySelector('[data-gate-app-state]');
    if (!st) return;
    const p = state.runs.get(box.dataset.run)?.preview || null;
    const status = p && (!p.approval || p.approval === box.dataset.approval) ? p.status : null;
    st.className = `gate-app-state${status ? ` st-${status}` : ''}`;
    st.textContent = { running: '● running', stopped: '○ stopped', failed: '● failed' }[status] || '';
    st.title = p?.command || '';
    box.querySelector('[data-gate-tool="stop"]')?.classList.toggle('hidden', status !== 'running');
    box.querySelector('[data-gate-tool="app-term"]')?.classList.toggle('hidden', !status || !dock.tabs.some((t) => t.key === `preview:${box.dataset.run}:${box.dataset.approval}`));
    const link = box.querySelector('[data-gate-app-url]');
    if (link && p?.url && status) { link.href = p.url; link.textContent = `Open ${p.url}`; link.classList.remove('hidden'); }
    const err = box.querySelector('[data-gate-app-error]');
    if (err) { err.textContent = status === 'failed' ? p.error || '' : ''; err.classList.toggle('hidden', !(status === 'failed' && p.error)); }
  });
}
window.paintGateApps = paintGateApps;

function setRunPreview(runId, preview) {
  const v = state.runs.get(runId);
  if (v) v.preview = preview;
  paintGateApps();
}

// The commands of a config as the confirmation shows them: `npm ci` + `npm start` (in apps/web)
const runAppCommandHtml = (c) => `${c.install ? `<code>${esc(c.install)}</code> + ` : ''}<code>${esc(c.command)}</code>${c.cwd ? ` in <code>${esc(c.cwd)}</code>` : ''}`;

// Run App's one-click confirmation (#115), a popover over the gate (never above its choices): a
// declared command (the repository's .multiagent/local-preview.yaml or the workflow's) the owner has
// not confirmed for this project yet, or changed since; or one detected from the worktree
// (localPreview:info → suggestConfig in src/local-preview.js), saved as the project's Local preview
// on Run. A monorepo's apps: the owner picks one (stored as cwd).
function runAppConfirmHtml(info, cfg) {
  const apps = info.suggestion?.apps || [];
  const pick = apps.length > 1 ? `<label class="small">App <select data-setup-app>${apps.map((a, i) => `<option value="${i}"${a.cwd === cfg.cwd ? ' selected' : ''}>${esc(a.cwd)}</option>`).join('')}</select></label>` : '';
  const from = info.config ? info.from : cfg.from;
  const lead = info.changed ? '<div class="small gate-app-changed">The declared run command changed since you confirmed it.</div>' : '';
  const saved = !info.config && info.project ? ` Saved as the Local preview of <b>${esc(info.project.name)}</b>, so the next gates run it in one click.` : '';
  const install = cfg.install ? `<div>${runAppInstallHtml(info)}</div>` : '';
  const run = !info.config && info.project ? 'Save as this project\'s Run App and start' : 'Run';
  return `${lead}<div>Run with ${runAppCommandHtml(cfg)}${from ? ` <span class="muted small">(from ${esc(from)})</span>` : ''}?</div>${pick}${install}
    <div class="muted small">It runs this repository's command on your machine, in simulation only, on a scratch copy of your workspace.${saved}</div>
    <div class="row"><button type="button" class="btn sm primary" data-gate-tool="app-run">${run}</button><button type="button" class="btn sm ghost" data-gate-tool="app-edit">Edit</button><button type="button" class="btn sm ghost" data-gate-tool="app-cancel">Cancel</button></div>`;
}

// Whether the install step runs in this worktree now (#119, localPreview:info's install): a badge and why.
function runAppInstallHtml(info) {
  const s = info.install;
  if (!s || s.state === 'none') return '';
  const [head, ...why] = String(s.text).split(': ');
  return `<span class="badge${s.state === 'will-run' ? ' warn' : ''}">${s.state === 'will-run' ? 'install will run' : 'install skipped'}</span> <span class="muted small">${esc(why.join(': ') || head)}</span>`;
}

// Run App's fields (Edit, or nothing found): install / command / URL / folder, saved as the
// project's Local preview and optionally written to the repository's .multiagent/local-preview.yaml.
function runAppSetupHtml(info, cfg = {}) {
  const input = (k, label, ph, hint = '') => `<label class="small">${label}<input data-setup="${k}" value="${esc(cfg[k] || '')}" placeholder="${esc(ph)}" spellcheck="false">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const found = cfg.from ? `From ${esc(cfg.from)}.` : info.suggestion || info.config ? '' : 'Nothing found in the worktree: write how to run it.';
  return `<div class="muted small">${found} ${info.project ? `Saving makes it the Run App of <b>${esc(info.project.name)}</b> (Projects › Local preview): the next gates start it in one click.` : 'This run has no project: it runs this time only.'}</div>
    ${input('install', 'Install (only when dependencies are missing or the lockfile changed)', 'npm ci (optional)', runAppInstallHtml(info))}
    ${input('command', 'Command', 'npm start')}
    ${input('url', 'URL (optional)', 'http://localhost:3000')}
    ${input('cwd', 'Folder (optional, a monorepo\'s app)', 'apps/web')}
    ${info.project ? '<label class="small gate-app-check"><input type="checkbox" data-setup-repo> Also write it to <code>.multiagent/local-preview.yaml</code> (a change you commit)</label>' : ''}
    <div class="row"><button type="button" class="btn sm primary" data-gate-tool="app-save">${info.project ? 'Save as this project\'s Run App and start' : 'Run'}</button><button type="button" class="btn sm ghost" data-gate-tool="app-cancel">Cancel</button></div>`;
}

// After Save (#119): said once, so the owner knows what the next Run App does.
const runAppSavedToast = (cfg) => showToast('Saved as this project\'s Run App', `Next time Run App starts ${cfg.command} directly.`);

// Shows the popover in one of its two forms; Esc closes it.
function showRunAppSetup(setup, info, cfg, mode) {
  setup._info = info;
  setup._cfg = cfg;
  setup.dataset.mode = mode;
  setup.dataset.project = info?.project?.id || '';
  setup.innerHTML = mode === 'confirm' ? runAppConfirmHtml(info, cfg) : runAppSetupHtml(info, cfg);
  setup.classList.remove('hidden');
  const app = setup.querySelector('[data-setup-app]');
  if (app) app.onchange = () => showRunAppSetup(setup, info, info.suggestion.apps[+app.value], 'confirm');
  setup.onkeydown = (ev) => { if (ev.key === 'Escape') { setup.classList.add('hidden'); setup.closest('.gate-tools')?.querySelector('[data-gate-tool="preview"]')?.focus({ preventScroll: true }); } };
  (setup.querySelector(mode === 'confirm' ? '[data-gate-tool="app-run"]' : '[data-setup="command"]'))?.focus({ preventScroll: true });
}

// confirm: the owner clicked Run on the confirmation of a command not confirmed for the project yet
async function startRunApp(box, runId, approval, config = null, confirm = false) {
  const real = !!box.querySelector('[data-gate-real]')?.checked;
  if (real && !(await confirmDialog('Run on your real workspace?', 'The local copy will use your REAL workspace (projects, runs, settings) instead of a scratch copy. It stays in simulation only, but anything it writes lands in your workspace.', 'Run on it'))) return;
  try {
    await openTerminal({ kind: 'preview', runId, sessionId: approval, label: 'Run App', open: (cols, rows) => api.startLocalPreview(runId, approval, real, cols, rows, config, confirm) });
  } catch (err) {
    setRunPreview(runId, { status: 'failed', approval, error: errMsg(err) });
    throw err;
  }
  paintGateApps();
}

function toggleGateTerminal(runId, approval) {
  const tab = dock.tabs.find((t) => t.key === `preview:${runId}:${approval}`);
  if (!tab) { showToast('No terminal', 'Run App has not started here yet.'); return; }
  const shown = !$('#term-dock').classList.contains('hidden') && !dock.collapsed && dock.active === tab;
  if (shown) setDockCollapsed(true);
  else { showDock(); activateTab(tab); }
}

async function onGateTool(e, runId) {
  const b = e.target.closest('[data-gate-tool]');
  const box = b?.closest('.gate-tools');
  if (!box || b.disabled) return;
  const { dir, approval } = box.dataset;
  const setup = box.querySelector('[data-gate-setup]');
  try {
    if (b.dataset.gateTool === 'folder') await api.openPath(dir);
    else if (b.dataset.gateTool === 'shell') {
      await openTerminal({ kind: 'shell', runId, sessionId: dir, label: 'Worktree', open: (cols, rows) => api.termOpen({ kind: 'shell', folder: dir, cols, rows }) });
    } else if (b.dataset.gateTool === 'diff') {
      DiffViewer.open({ runId, approvalId: approval });
    } else if (b.dataset.gateTool === 'stop') {
      if (!await api.stopLocalPreview(runId)) showToast('No local preview', 'This run has no local preview running.');
    } else if (b.dataset.gateTool === 'app-term') {
      toggleGateTerminal(runId, approval);
    } else if (b.dataset.gateTool === 'app-cancel') {
      setup?.classList.add('hidden');
    } else if (b.dataset.gateTool === 'app-edit') {
      showRunAppSetup(setup, setup._info || {}, setup._cfg || {}, 'edit');
    } else if (b.dataset.gateTool === 'app-run') {
      const info = setup._info || {};
      const cfg = setup._cfg;
      setup.classList.add('hidden');
      // a declared command: confirmed for the project; a detected one: saved as its Local preview
      if (info.config) { await startRunApp(box, runId, approval, null, true); return; }
      const { from, apps, ...clean } = cfg;
      if (setup.dataset.project) { await api.saveLocalPreview(runId, approval, clean, false); runAppSavedToast(clean); }
      const run = box.querySelector('[data-gate-tool="preview"]');
      if (run) run.textContent = runAppLabel(clean);
      await startRunApp(box, runId, approval, setup.dataset.project ? null : clean, true);
    } else if (b.dataset.gateTool === 'app-save') {
      const val = (k) => setup.querySelector(`[data-setup="${k}"]`)?.value.trim() || '';
      const cfg = { install: val('install') || null, command: val('command'), url: val('url') || null, cwd: val('cwd') || null, env: setup._cfg?.env };
      if (!cfg.command) { showToast('Write the command first', 'Run App runs that command in the worktree.'); setup.querySelector('[data-setup="command"]')?.focus({ preventScroll: true }); return; }
      const writeRepo = !!setup.querySelector('[data-setup-repo]')?.checked;
      if (setup.dataset.project) {
        const saved = await api.saveLocalPreview(runId, approval, cfg, writeRepo);
        if (saved?.file) showToast('Wrote the run command', `${saved.file}: commit it so everyone gets one-click Run App.`);
        else runAppSavedToast(cfg);
      }
      setup.classList.add('hidden');
      const run = box.querySelector('[data-gate-tool="preview"]');
      if (run) run.textContent = runAppLabel(cfg);
      // saved: the service reads the project's config; no project: this time only
      await startRunApp(box, runId, approval, setup.dataset.project ? null : cfg, true);
    } else if (b.dataset.gateTool === 'preview') {
      const info = (await api.localPreviewInfo(runId, approval)) || {};
      if (info.repoError) showToast('Could not read the run command file', info.repoError);
      if (info.config && info.confirmed) {
        b.textContent = runAppLabel(info.config);
        await startRunApp(box, runId, approval);
        return;
      }
      // asks once: a declared command not confirmed yet (or changed), a detected one, else the fields
      const cfg = info.config || info.suggestion;
      showRunAppSetup(setup, info, cfg || {}, cfg ? 'confirm' : 'edit');
    }
  } catch (err) {
    showToast('Could not do it', errMsg(err));
  }
}
