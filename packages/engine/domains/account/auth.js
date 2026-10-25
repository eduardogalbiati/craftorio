// Account sign-in (Supabase Auth with OAuth providers). No Electron here: src/host/main.js passes an
// encrypted storage and a way to open the system browser. The app is free: the account gates
// nothing, it only counts the people using the app (#315).
//
// Sign-in follows the native-app pattern (RFC 8252): the system browser goes through the
// provider and Supabase, which redirect to a one-shot server on 127.0.0.1 with an authorization
// code; the app exchanges it for a session with its PKCE verifier. Provider secrets live only in
// Supabase. A signed-in app records "last seen", its version and the OS through the
// `touch_account()` database function (see supabase/migrations): at every start, then at most
// once a day. It is best effort: a failure is logged, never shown, and never blocks.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { appPackage } = require('../workspace/app-root');

const CALLBACK_PORT = 47823; // must match the redirect URL allowed in Supabase (URL Configuration)
const CALLBACK_PATH = '/auth/callback';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
// the last signed-in user, kept so that an offline start stays signed in
const ACCOUNT_KEY = 'multiagent-account';
const DAY_MS = 24 * 60 * 60 * 1000;

const PROVIDERS = [
  { id: 'google', name: 'Google' },
  { id: 'azure', name: 'Microsoft' },
  { id: 'github', name: 'GitHub' },
];

// Key-value storage kept in one file, encrypted by the caller's functions (session tokens, the
// PKCE verifier and the last signed-in user). Same interface as the storage supabase-js expects.
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

const userView = (u) => u && {
  id: u.id,
  email: u.email || null,
  name: u.user_metadata?.full_name || u.user_metadata?.name || null,
  providers: u.app_metadata?.providers || [],
};

/**
 * @param url, key       Supabase project URL and publishable key ('' = sign-in not configured)
 * @param required       true: the app asks for a sign-in before it can be used
 * @param providers      provider ids enabled in Supabase; the others show as "coming soon"
 * @param storage        getItem/setItem/removeItem (see fileStorage)
 * @param openExternal   (url) => opens the system browser
 * @param appVersion     recorded with each touch of the account
 */
function createAuth({
  url, key, required = true, providers = ['google'], storage, openExternal,
  createClient = (...a) => require('@supabase/supabase-js').createClient(...a),
  now = Date.now, port = CALLBACK_PORT, appVersion = appPackage().version,
}) {
  const configured = !!(url && key);
  const listeners = new Set();
  let user = null;
  let touchedAt = null; // when this app last recorded the visit (at start, then at most daily)
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
    };
  }
  const notify = () => { const s = state(); for (const cb of listeners) cb(s); };

  const stored = () => { try { return JSON.parse(storage.getItem(ACCOUNT_KEY))?.user || null; } catch { return null; } };

  // Best effort: records "last seen", the app version and the OS of the signed-in user, once per
  // start and then at most once a day. Never awaited; a failure is only logged. `at` is when the
  // refresh began, so a slow session reload does not push the next day's touch a day later.
  function touch(at) {
    if (touchedAt !== null && at - touchedAt < DAY_MS) return;
    touchedAt = at;
    const failed = (message) => console.error(`account: could not record the visit: ${message}`);
    Promise.resolve()
      .then(() => client.rpc('touch_account', { app_version: appVersion, platform: process.platform }))
      .then((r) => { if (r?.error) failed(r.error.message); }, (e) => failed(e.message));
  }

  // Reloads the session (refreshing its token when needed), then touches the account.
  async function refresh() {
    if (!configured) return state();
    const startedAt = now();
    let session = null;
    let reached = true;
    try {
      const { data, error } = await client.auth.getSession();
      reached = !error;
      session = data?.session || null;
    } catch {
      reached = false;
    }
    if (session?.user) {
      user = session.user;
      storage.setItem(ACCOUNT_KEY, JSON.stringify({ user }));
    } else if (reached) {
      // no session (signed out, or it expired): an offline start must not bring the user back
      user = null;
      storage.removeItem(ACCOUNT_KEY);
    } else {
      // the account server can't be reached: a user who signed in once stays signed in
      user = stored();
    }
    if (user) touch(startedAt);
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
    storage.removeItem(ACCOUNT_KEY);
    user = null;
    touchedAt = null;
    notify();
    return state();
  }

  if (client) {
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && user) { user = null; storage.removeItem(ACCOUNT_KEY); notify(); }
    });
  }

  return {
    state,
    refresh,
    signIn,
    cancelSignIn: () => { pending?.cancel(); return state(); },
    signOut,
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

module.exports = {
  CALLBACK_PATH,
  CALLBACK_PORT,
  createAuth,
  fileStorage,
  PROVIDERS,
};
