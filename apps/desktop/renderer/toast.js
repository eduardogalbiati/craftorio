// The toast's countdown and its action (#281), for app.js's showToast, which keeps what the toast
// says and where a click on it leads (a run, a waiting gate). Uses app.js's esc and errMsg.
// - The toast hides by itself (after `ms`, 10 s with an action) and at a click, its × included.
// - action: { label, run, done? }, a button inside the toast ("Undo"). A click on the button runs it
//   once and the toast then says its outcome (`done`, "Restored" by default, or the error); a click
//   elsewhere on such a toast does nothing, × dismisses it without running the action. The countdown
//   waits while the pointer is over the toast or its button has the focus.

let toastTimer = null;
let toastHold = null; // { pause, resume } of the countdown of a toast with an action
let toastBound = false;

// el: the toast's element; html(head, text): its markup without the action's button; ms: how long
// it stays without an action; onClick(e): a click on it once it hid (× included; never the action's).
function openToast(el, { html, title, detail, action = null, ms, onClick }) {
  const draw = (head, text, button) => {
    el.innerHTML = html(head, text) + (button ? `<button type="button" class="btn sm toast-action" data-toast-action>${esc(button.label)}</button>` : '');
    el.classList.toggle('has-action', !!button);
  };
  const hide = () => el.classList.add('hidden');
  const countdown = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, action ? 10000 : ms);
  };
  draw(title, detail, action);
  el.classList.remove('hidden');
  countdown();
  toastHold = action ? { pause: () => clearTimeout(toastTimer), resume: countdown } : null;
  if (!toastBound) {
    toastBound = true;
    for (const [type, what] of [['mouseenter', 'pause'], ['focusin', 'pause'], ['mouseleave', 'resume'], ['focusout', 'resume']]) el.addEventListener(type, () => toastHold?.[what]());
  }
  let ran = false;
  let dismissed = false;
  const onclick = async (e) => {
    if (action && !e.target.closest('.toast-close')) {
      // only its button runs the action, once; its outcome ("Restored", or the error) takes the toast's place
      if (ran || !e.target.closest('[data-toast-action]')) return;
      ran = true;
      let outcome;
      let failed = false;
      try { await action.run(); outcome = action.done || 'Restored'; } catch (err) { outcome = errMsg(err); failed = true; }
      // unless a newer toast is shown meanwhile, or × was pressed while it ran (an error still shows)
      if (el.onclick === onclick && (failed || !dismissed)) { draw(outcome, '', null); el.classList.remove('hidden'); countdown(); }
      return;
    }
    dismissed = true;
    hide();
    onClick(e);
  };
  el.onclick = onclick;
}
