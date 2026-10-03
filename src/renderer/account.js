/* global api */
// Account: the sign-in screen and the trial chip in the top bar (initAccount, from app.js's init()).

// Account: sign-in screen and the trial chip in the top bar
function initAccount() {
  $('#account-btn').onclick = () => {
    const open = $('#account-pop').classList.toggle('hidden') === false;
    $('#account-btn').setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('mousedown', (e) => {
    if (!$('#account-pop').classList.contains('hidden') && !e.target.closest('.account-wrap')) $('#account-pop').classList.add('hidden');
  });
  $('#btn-sign-out').onclick = async () => {
    $('#account-pop').classList.add('hidden');
    renderAccount(await api.signOut());
  };
  $('#btn-login-cancel').onclick = () => api.cancelSignIn();
  api.onAuthChange(renderAccount);
  api.authState().then(renderAccount);
}

async function signIn(provider) {
  $('#login-error').textContent = '';
  try {
    renderAccount(await api.signIn(provider));
  } catch (e) {
    const msg = errMsg(e);
    if (msg !== 'Sign-in cancelled.') $('#login-error').textContent = msg;
  }
}

function trialLabel(ent) {
  if (!ent) return { text: '…', cls: 'pill-idle' };
  if (ent.error) return { text: 'Account unavailable', cls: 'pill-trial-ended' };
  if (ent.plan === 'pro') return { text: 'Pro', cls: 'pill-pro' };
  if (!ent.active) return { text: 'Trial ended', cls: 'pill-trial-ended' };
  const days = ent.daysLeft === 1 ? '1 day' : `${ent.daysLeft} days`;
  return { text: `Trial · ${days} left`, cls: ent.daysLeft <= 2 ? 'pill-trial-low' : 'pill-trial' };
}

function renderAccount(s) {
  if (!s) return;
  state.account = s;
  // sign-in screen: when runs need an account and nobody is signed in
  const needsLogin = s.required && !s.user;
  $('#login-screen').classList.toggle('hidden', !needsLogin);
  $('#login-waiting').classList.toggle('hidden', !s.signingIn);
  $('#login-providers').innerHTML = s.providers.map((p) => `<button class="btn ${p.enabled ? '' : 'ghost'}" type="button" data-provider="${esc(p.id)}" ${p.enabled && !s.signingIn ? '' : 'disabled'}>Continue with ${esc(p.name)}${p.enabled ? '' : ' <span class="soon">coming soon</span>'}</button>`).join('');
  $('#login-providers').querySelectorAll('[data-provider]').forEach((b) => (b.onclick = () => signIn(b.dataset.provider)));
  if (needsLogin && !s.configured) $('#login-error').textContent = 'Sign-in is not configured in this build.';

  // top bar chip
  $('#account-wrap').classList.toggle('hidden', !s.user);
  if (!s.user) return;
  const ent = s.entitlement;
  const label = trialLabel(ent);
  $('#account-avatar').textContent = (s.user.name || s.user.email || '?').trim()[0].toUpperCase();
  $('#account-trial').textContent = label.text;
  $('#account-trial').className = `pill ${label.cls}`;
  $('#account-btn').title = s.user.email || '';
  $('#account-name').textContent = s.user.name || s.user.email || 'Signed in';
  $('#account-email').textContent = s.user.name ? s.user.email || '' : '';
  $('#account-plan').textContent = !ent ? 'Checking your subscription…'
    : ent.error ? ent.error
    : ent.plan === 'pro' ? 'Pro plan.'
    : ent.active ? `Free trial until ${new Date(ent.trialEndsAt).toLocaleString()}.${ent.offline ? ' (offline: last check)' : ''}`
    : 'Your free trial has ended. You can still browse your projects, runs and artifacts; simulations still run.';
}
