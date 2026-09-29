// Account sign-in (Supabase Auth with OAuth providers) and the free trial. No Electron here:
// src/main.js passes an encrypted storage and a way to open the system browser.
//
// Sign-in follows the native-app pattern (RFC 8252): the system browser goes through the
// provider and Supabase, which redirect to a one-shot server on 127.0.0.1 with an authorization
// code; the app exchanges it for a session with its PKCE verifier. Provider secrets live only in
// Supabase. What the user may do comes from the `entitlement()` database function, computed with
// the server's clock (see supabase/migrations).

const http = require('http');
const fs = require('fs');
const path = require('path');

const CALLBACK_PORT = 47823; // must match the redirect URL allowed in Supabase (URL Configuration)
const CALLBACK_PATH = '/auth/callback';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// how long the last entitlement is trusted while the account server can't be reached
const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const ENTITLEMENT_KEY = 'multiagent-entitlement';
const DAY_MS = 24 * 60 * 60 * 1000;

const PROVIDERS = [
  { id: 'google', name: 'Google' },
  { id: 'azure', name: 'Microsoft' },
  { id: 'github', name: 'GitHub' },
];

const TRIAL_ENDED = 'Your 7-day free trial has ended. Runs can no longer be started or resumed; your projects, runs and artifacts are still available.';

// Key-value storage kept in one file, encrypted by the caller's functions (session tokens, the
// PKCE verifier and the last entitlement). Same interface as the storage supabase-js expects.
function fileStorage(file, { encrypt = (s) => Buffer.from(s, 'utf8'), decrypt = (b) => b.toString('utf8') } = {}) {
  let data = null;
  const load = () => {
    if (data) return data;
    let raw = null;
    try { raw = fs.readFileSync(file); } catch { /* no file yet */ }
    try {
      data = raw ? JSON.parse(decrypt(raw)) : {};
    } catch (e) {
      // the session is lost (sign-in needed again): say why instead of failing silently
      console.error(`account storage: could not read ${file}: ${e.message}`);
      data = {};
    }
    return data;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encrypt(JSON.stringify(data)));
  };
  return {
    getItem: (k) => load()[k] ?? null,
    setItem: (k, v) => { load()[k] = v; save(); },
    removeItem: (k) => { if (k in load()) { delete data[k]; save(); } },
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const callbackPage = (message) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Multiagent Orchestrator</title></head>
<body style="font:15px system-ui,sans-serif;background:#0e1014;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0">
<p>${escapeHtml(message)}</p></body></html>`;

// The entitlement as the UI shows it. `active` and the days left use the server's clock, shifted
// by the time elapsed since the check.
function entitlementView(e, now) {
  const serverNow = Date.parse(e.server_time) + (now - e.checked_at);
  const ends = Date.parse(e.trial_ends_at);
  const pro = e.plan === 'pro';
  return {
    plan: e.plan,
    trialEndsAt: e.trial_ends_at,
    active: pro || ends > serverNow,
    daysLeft: pro ? null : Math.max(0, Math.ceil((ends - serverNow) / DAY_MS)),
    offline: !!e.offline,
  };
}

const userView = (u) => u && {
  id: u.id,
  email: u.email || null,
  name: u.user_metadata?.full_name || u.user_metadata?.name || null,
  providers: u.app_metadata?.providers || [],
};

/**
 * @param url, key       Supabase project URL and publishable key ('' = sign-in not configured)
 * @param required       true: runs need a signed-in user with an active entitlement
 * @param providers      provider ids enabled in Supabase; the others show as "coming soon"
 * @param storage        getItem/setItem/removeItem (see fileStorage)
 * @param openExternal   (url) => opens the system browser
 */
function createAuth({
  url, key, required = true, providers = ['google'], storage, openExternal,
  createClient = (...a) => require('@supabase/supabase-js').createClient(...a),
  now = Date.now, port = CALLBACK_PORT,
}) {
  const configured = !!(url && key);
  const listeners = new Set();
  let user = null;
  let ent = null; // last entitlement record, or { error }
  let pending = null; // sign-in in progress: { cancel }

  const client = configured && createClient(url, key, {
    auth: { flowType: 'pkce', storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  function state() {
    return {
      configured,
      required,
      providers: PROVIDERS.map((p) => ({ ...p, enabled: providers.includes(p.id) })),
      signingIn: !!pending,
      user: userView(user),
      entitlement: !ent ? null : ent.error ? { error: ent.error } : entitlementView(ent, now()),
    };
  }
  const notify = () => { const s = state(); for (const cb of listeners) cb(s); };

  const cached = () => { try { return JSON.parse(storage.getItem(ENTITLEMENT_KEY)); } catch { return null; } };

  // Reloads the session (refreshing its token when needed) and the entitlement.
  async function refresh() {
    if (!configured) return state();
    const { data, error } = await client.auth.getSession();
    const last = cached();
    if (error && last?.user) {
      // the account server is unreachable: keep the last known user for a few days
      user = last.user;
      ent = now() - last.checked_at < OFFLINE_GRACE_MS ? { ...last, offline: true } : { error: 'Could not reach the account server to check your subscription.' };
      notify();
      return state();
    }
    user = data?.session?.user || null;
    if (!user) {
      ent = null;
      notify();
      return state();
    }
    const r = await client.rpc('entitlement');
    if (!r.error && r.data) {
      ent = { ...r.data, checked_at: now(), user: userView(user) };
      storage.setItem(ENTITLEMENT_KEY, JSON.stringify(ent));
    } else if (r.error && last?.user?.id === user.id && now() - last.checked_at < OFFLINE_GRACE_MS) {
      ent = { ...last, offline: true };
    } else {
      ent = { error: r.error ? 'Could not reach the account server to check your subscription.' : 'No account was found for this user.' };
    }
    notify();
    return state();
  }

  // Waits for the browser to come back to 127.0.0.1 with the authorization code.
  function waitForCode(provider) {
    const redirectTo = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    return new Promise((resolve, reject) => {
      let done = false;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, redirectTo);
        if (u.pathname !== CALLBACK_PATH) { res.writeHead(404, { Connection: 'close' }).end(); return; }
        const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        const code = u.searchParams.get('code');
        const ok = code && !err;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
          .end(callbackPage(ok ? 'Signed in. You can close this tab and go back to Multiagent Orchestrator.' : `Sign-in failed: ${err || 'no authorization code'}.`));
        finish(ok ? null : new Error(`Sign-in failed: ${err || 'no authorization code.'}`), code);
      });
      const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), LOGIN_TIMEOUT_MS);
      function finish(error, code) {
        if (done) return;
        done = true;
        pending = null;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
        if (error) reject(error); else resolve(code);
        notify();
      }
      pending = { cancel: () => finish(new Error('Sign-in cancelled.')) };
      server.on('error', (e) => finish(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use by another program; close it and try again.`) : e));
      server.listen(port, '127.0.0.1', async () => {
        try {
          const { data, error } = await client.auth.signInWithOAuth({
            provider,
            options: { redirectTo, skipBrowserRedirect: true, queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined },
          });
          if (error) throw error;
          await openExternal(data.url);
          notify();
        } catch (e) {
          finish(e);
        }
      });
    });
  }

  async function signIn(provider) {
    if (!configured) throw new Error('Sign-in is not configured in this build.');
    if (!providers.includes(provider)) throw new Error(`Sign-in with ${PROVIDERS.find((p) => p.id === provider)?.name || provider} is not available yet.`);
    pending?.cancel();
    const code = await waitForCode(provider);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw new Error(`Sign-in failed: ${error.message}`);
    return refresh();
  }

  async function signOut() {
    if (configured) {
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* the local session is dropped anyway */ }
    }
    storage.removeItem(ENTITLEMENT_KEY);
    user = null;
    ent = null;
    notify();
    return state();
  }

  // Throws when a run can't start: simulations always can; real runs need a signed-in user whose
  // trial or plan is active.
  async function assertCanRun({ mock } = {}) {
    if (mock || !required) return;
    if (!configured) throw new Error('Sign-in is not configured in this build.');
    try { await refresh(); } catch { /* judged with what is known */ }
    const s = state();
    if (!s.user) throw new Error('Sign in to start runs.');
    if (s.entitlement?.error) throw new Error(s.entitlement.error);
    if (!s.entitlement?.active) throw new Error(TRIAL_ENDED);
  }

  if (client) {
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && user) { user = null; ent = null; notify(); }
    });
  }

  return {
    state,
    refresh,
    signIn,
    cancelSignIn: () => { pending?.cancel(); return state(); },
    signOut,
    assertCanRun,
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

module.exports = { createAuth, fileStorage, entitlementView, PROVIDERS, CALLBACK_PORT, CALLBACK_PATH, TRIAL_ENDED };
