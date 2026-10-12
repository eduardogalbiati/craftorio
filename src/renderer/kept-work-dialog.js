// The kept-work question (#170, redone in #288): the confirm modal's named-choice variant
// (choiceDialog) and the question a start asks when it would redo an ended run's work
// (keptWorkDialog: the Backlog's assign, queue resume and Retry, Write & Review). Uses app.js's
// confirm modal and helpers.

// A question with several named answers, in the confirm modal: choices [{ id, label, line, title,
// primary }] (line: what the choice does, listed under the message; title: the button's tooltip;
// primary: the recommended one, answered by Enter). opts.details: lines in a closed Details
// disclosure; opts.link: { label, testid, onClick } a link under the buttons that closes the dialog
// (resolves null) and runs onClick. Esc is Cancel. Resolves the chosen id, or null on Cancel.
function choiceDialog(title, message, choices, opts = {}) {
  const modal = $('#confirm-modal');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const lines = $('#confirm-details');
  lines.innerHTML = choices.filter((c) => c.line).map((c) => `<li>${esc(c.line)}</li>`).join('');
  lines.classList.toggle('hidden', !lines.children.length);
  const added = [];
  const details = (opts.details || []).filter(Boolean);
  if (details.length) {
    const box = document.createElement('details');
    box.className = 'confirm-more small muted';
    box.innerHTML = `<summary>Details</summary><ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
    lines.after(box);
    added.push(box);
  }
  const yes = $('#btn-confirm-yes');
  yes.classList.add('hidden');
  const buttons = choices.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${c.primary ? 'primary' : 'ghost'}`;
    b.textContent = c.label;
    b.dataset.choice = c.id;
    if (c.title) b.title = c.title;
    yes.before(b);
    return b;
  });
  let link = null;
  if (opts.link) {
    link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn small confirm-link';
    link.textContent = opts.link.label;
    if (opts.link.testid) link.dataset.testid = opts.link.testid;
    yes.closest('.modal-actions').after(link);
    added.push(link);
  }
  openModal('#confirm-modal');
  (buttons.find((b) => b.classList.contains('primary')) || $('#btn-confirm-no')).focus?.({ preventScroll: true });
  return new Promise((resolve) => {
    const done = (id) => {
      closeModal('#confirm-modal');
      for (const b of [...buttons, ...added]) b.remove();
      yes.classList.remove('hidden');
      modal.removeEventListener('keydown', onKey);
      resolve(id);
    };
    // Enter answers the primary choice (a focused button answers itself), Esc is Cancel
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key !== 'Enter' || e.target.closest?.('button, a, summary, textarea, input, select')) return;
      const primary = buttons.find((b) => b.classList.contains('primary'));
      if (!primary) return;
      e.preventDefault();
      done(primary.dataset.choice);
    };
    modal.addEventListener('keydown', onKey);
    for (const b of buttons) b.onclick = () => done(b.dataset.choice);
    if (link) link.onclick = () => { done(null); opts.link.onClick(); };
    $('#btn-confirm-no').onclick = () => done(null);
  });
}

// The kept-work question (#170, #288) of a start that would redo an ended run's work: Resume the old
// run at the step where it stopped, at once (its "choose another step…" link opens Resume from step…
// instead), or Start over. Resolves 'scratch', 'resume' or null.
async function keptWorkDialog(kept) {
  const details = Array.isArray(kept.details) ? kept.details : kept.details ? [kept.details] : [];
  const id = await choiceDialog(kept.title, kept.message, kept.choices, {
    details,
    link: { label: 'choose another step…', testid: 'kept-work-choose-step', onClick: () => window.openResumeDialog?.(kept.runId) },
  });
  if (id !== 'resume') return id;
  if (!kept.stoppedAt) { window.openResumeDialog?.(kept.runId); return id; }
  // a decided human gate before the stopped step: the engine refuses a direct resume (#112), so
  // the owner approves it again in Resume from step… (that step chosen) instead of an error
  let stopped = null;
  try { stopped = (await api.resumeOptions(kept.runId))?.steps?.find((s) => s.id === kept.stoppedAt) || null; } catch { /* resumeRun says why below */ }
  if (stopped?.blockedBy) {
    window.openResumeDialog?.(kept.runId, { step: kept.stoppedAt, note: 'Resume did not go straight on: a human gate decided before the step where the run stopped must be approved again first.' });
    return id;
  }
  try {
    const simulate = typeof devMode === 'function' && devMode();
    const { runId } = await api.resumeRun(kept.runId, kept.stoppedAt, undefined, simulate);
    showRun(runId, { running: true });
  } catch (e) {
    // refused (e.g. the run is active again): the dialog says why and offers the other steps
    showToast('Could not resume the run', errMsg(e));
    window.openResumeDialog?.(kept.runId, { step: kept.stoppedAt });
  }
  return id;
}
