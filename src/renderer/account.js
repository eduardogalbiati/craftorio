/* global api */
// Account: the sign-in screen and the account chip in the top bar (initAccount, from app.js's init()).
// The account gates nothing: it only counts the people using the app (#315, src/auth.js).

// Account: sign-in screen and the account chip (name or email) in the top bar
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

function renderAccount(s) {
  if (!s) return;
  state.account = s;
  // sign-in screen: when the app asks for an account and nobody is signed in
  const needsLogin = s.required && !s.user;
  $('#login-screen').classList.toggle('hidden', !needsLogin);
  $('#login-waiting').classList.toggle('hidden', !s.signingIn);
  $('#login-providers').innerHTML = s.providers.map((p) => `<button class="btn ${p.enabled ? '' : 'ghost'}" type="button" data-provider="${esc(p.id)}" ${p.enabled && !s.signingIn ? '' : 'disabled'}>${t('account.continue_with')} ${esc(p.name)}${p.enabled ? '' : ` <span class="soon">${t('account.coming_soon')}</span>`}</button>`).join('');
  $('#login-providers').querySelectorAll('[data-provider]').forEach((b) => (b.onclick = () => signIn(b.dataset.provider)));
  if (needsLogin && !s.configured) $('#login-error').textContent = 'Sign-in is not configured in this build.';

  // top bar chip
  $('#account-wrap').classList.toggle('hidden', !s.user);
  if (!s.user) return;
  const shown = s.user.name || s.user.email || 'Signed in';
  $('#account-avatar').textContent = shown.trim()[0].toUpperCase();
  $('#account-chip-name').textContent = shown;
  $('#account-btn').title = s.user.email || '';
  $('#account-name').textContent = shown;
  $('#account-email').textContent = s.user.name ? s.user.email || '' : '';
}
