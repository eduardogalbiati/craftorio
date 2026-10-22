/* global api */
// Settings › Agents & CLIs › Accounts (#312): settings.providers.<provider>.accounts, the accounts of
// each CLI that keeps its account in a config folder (the adapter's configDirEnv: CLAUDE_CONFIG_DIR,
// CODEX_HOME; Grok has none, so it is not listed), in order: a name, the folder and Enabled. A turn
// runs on the first enabled account; at its usage limit it moves to the next one (src/engine/run/
// accounts.js). A row whose folder is set shows whether that folder is signed in and, while it is
// not (or the row is new), the command that logs it in (settings:accountStatus, never a credential).
// settings.accountCooldownMinutes: how long an account stays out after a limit with no reset time.
// Saved with the Fallbacks' Save (settings.js saveFallbackSettings).
// window.AccountsSettings = { render(el, settings), collect(el) }: settings.js draws it into
// #set-accounts; uses app.js globals (esc) and window.I18n (t), window.Providers.
(() => {
  const providerIds = (settings) => {
    const withVar = window.Providers.clis().filter((a) => a.configDirEnv).map((a) => a.id);
    const saved = Object.entries(settings.providers || {}).filter(([, p]) => p?.accounts?.length).map(([id]) => id);
    return [...new Set([...withVar, ...saved])];
  };

  function rowHtml(account = {}, isNew = false) {
    return `<div class="acct-row" data-testid="settings-account-row"${isNew ? ' data-new="1"' : ''}>
        <div class="acct-fields">
          <input type="text" data-acct="name" value="${esc(account.name || '')}" placeholder="${esc(t('settings.accounts.name_placeholder'))}" aria-label="${t('settings.accounts.name')}" spellcheck="false" />
          <input type="text" data-acct="dir" class="mono" value="${esc(account.dir || '')}" placeholder="${esc(t('settings.accounts.dir_placeholder'))}" aria-label="${t('settings.accounts.dir')}" spellcheck="false" title="${esc(account.dir || '')}" />
          <label class="small acct-enabled"><input type="checkbox" data-acct="enabled"${account.enabled === false ? '' : ' checked'} />${t('settings.accounts.enabled')}</label>
          <span class="pill pill-idle hidden" data-testid="settings-account-signed-in"></span>
          <button type="button" class="btn sm ghost" data-acct-remove aria-label="${t('settings.accounts.remove')}">${t('settings.accounts.remove')}</button>
        </div>
        <div class="acct-login small muted hidden">${t('settings.accounts.login')} <code class="mono" data-testid="settings-account-login-command"></code></div>
      </div>`;
  }

  function providerHtml(id, accounts) {
    const adapter = window.Providers.resolve(id);
    return `<div class="s-row acct-provider" data-testid="settings-accounts-provider" data-provider="${esc(id)}">
        <div class="s-label"><b>${esc(adapter?.label || id)}</b><span>${t('settings.accounts.row', { variable: `<code>${esc(adapter?.configDirEnv || '')}</code>` })}</span></div>
        <div class="acct-list">${accounts.map((a) => rowHtml(a)).join('')}</div>
        <button type="button" class="btn sm ghost" data-testid="settings-account-add">${t('settings.accounts.add')}</button>
      </div>`;
  }

  // the folder's sign-in state and, when it is not signed in (or the row is new), its login command
  async function check(row) {
    const provider = row.closest('[data-provider]').dataset.provider;
    const dir = row.querySelector('[data-acct="dir"]').value.trim();
    const badge = row.querySelector('[data-testid="settings-account-signed-in"]');
    const login = row.querySelector('.acct-login');
    badge.classList.toggle('hidden', !dir);
    login.classList.toggle('hidden', true);
    if (!dir) return;
    let status = { signedIn: false, loginCommand: null };
    try { status = await api.accountStatus({ provider, dir }); } catch { /* an unreadable folder reads as not signed in */ }
    if (row.querySelector('[data-acct="dir"]').value.trim() !== dir) return;
    badge.textContent = t(status.signedIn ? 'settings.accounts.signed_in' : 'settings.accounts.not_signed_in');
    badge.className = `pill ${status.signedIn ? 'pill-success' : 'pill-cancelled'}`;
    row.querySelector('[data-testid="settings-account-login-command"]').textContent = status.loginCommand || '';
    login.classList.toggle('hidden', !status.loginCommand || (status.signedIn && !row.dataset.new));
  }

  function render(el, settings) {
    const providers = settings.providers || {};
    el.innerHTML = providerIds(settings).map((id) => providerHtml(id, providers[id]?.accounts || [])).join('');
    const cooldown = document.getElementById('set-account-cooldown');
    if (cooldown) cooldown.value = settings.accountCooldownMinutes ?? 60;
    el.querySelectorAll('[data-testid="settings-account-row"]').forEach(check);
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const add = e.target.closest('[data-testid="settings-account-add"]');
      if (add) {
        const list = add.closest('[data-provider]').querySelector('.acct-list');
        list.insertAdjacentHTML('beforeend', rowHtml({}, true));
        list.lastElementChild.querySelector('[data-acct="name"]').focus();
      }
      if (e.target.closest('[data-acct-remove]')) e.target.closest('[data-testid="settings-account-row"]').remove();
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.acct === 'dir') check(e.target.closest('[data-testid="settings-account-row"]'));
    });
  }

  // { accounts: { <provider>: [{ name, dir, enabled }] }, cooldown, invalid: the first incomplete field }
  function collect(el) {
    const accounts = {};
    let invalid = null;
    for (const box of el.querySelectorAll('[data-provider]')) {
      accounts[box.dataset.provider] = [];
      for (const row of box.querySelectorAll('[data-testid="settings-account-row"]')) {
        const field = (k) => row.querySelector(`[data-acct="${k}"]`);
        const [name, dir] = [field('name').value.trim(), field('dir').value.trim()];
        if (!name && !dir) continue;
        if (!name || !dir) invalid = invalid || field(name ? 'dir' : 'name');
        accounts[box.dataset.provider].push({ name, dir, enabled: field('enabled').checked });
      }
    }
    const minutes = Number(document.getElementById('set-account-cooldown')?.value);
    return { accounts, cooldown: minutes > 0 ? minutes : null, invalid };
  }

  window.AccountsSettings = { collect, render };
})();
