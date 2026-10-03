// The kept-work question (#170): the confirm modal's named-choice variant (choiceDialog) and the
// question a start asks when it would redo an ended run's work (keptWorkDialog: the Backlog's
// assign, queue resume and Retry, Write & Review). Uses app.js's confirm modal and helpers.

// A question with several named answers, in the confirm modal: choices [{ id, label, line, primary }]
// (line: what the choice does, listed under the message; primary: the recommended one). Resolves the
// chosen id, or null on Cancel.
function choiceDialog(title, message, choices) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const details = $('#confirm-details');
  details.innerHTML = choices.filter((c) => c.line).map((c) => `<li>${esc(c.line)}</li>`).join('');
  details.classList.toggle('hidden', !details.children.length);
  const yes = $('#btn-confirm-yes');
  yes.classList.add('hidden');
  const buttons = choices.map((c) => {
    const b = document.createElement('button');
    b.className = `btn ${c.primary ? 'primary' : 'ghost'}`;
    b.textContent = c.label;
    b.dataset.choice = c.id;
    yes.before(b);
    return b;
  });
  openModal('#confirm-modal');
  return new Promise((resolve) => {
    const done = (id) => {
      closeModal('#confirm-modal');
      for (const b of buttons) b.remove();
      yes.classList.remove('hidden');
      resolve(id);
    };
    for (const b of buttons) b.onclick = () => done(b.dataset.choice);
    $('#btn-confirm-no').onclick = () => done(null);
  });
}

// The kept-work question (#170) of a start that would redo an ended run's work: Resume the old run
// (opens Resume from step… for it) or Start from scratch. Resolves 'scratch', 'resume' or null.
async function keptWorkDialog(kept) {
  const id = await choiceDialog(kept.title, kept.message, kept.choices);
  if (id === 'resume') window.openResumeDialog?.(kept.runId);
  return id;
}
