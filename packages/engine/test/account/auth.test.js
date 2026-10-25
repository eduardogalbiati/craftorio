const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createAuth, fileStorage } = require('../../domains/account/auth');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const USER = { id: 'u1', email: 'ana@example.com', user_metadata: { full_name: 'Ana' }, app_metadata: { providers: ['google'] } };
const APP_VERSION = '1.2.3';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
};

// Stand-in for the supabase-js client (the boundary): `session` is set by the test; every rpc call
// is recorded with its arguments. `rpcError` answers { error }, `rpcReject` makes the call throw.
function fakeSupabase({ session = null, rpcError = null, rpcReject = null, sessionError = null } = {}) {
  const sb = {
    session, rpcError, rpcReject, sessionError, calls: [], authListeners: [], beforeGetSession: null,
    auth: {
      getSession: async () => {
        sb.beforeGetSession?.();
        return sb.sessionError ? { data: { session: null }, error: sb.sessionError } : { data: { session: sb.session }, error: null };
      },
      signInWithOAuth: async ({ provider, options }) => {
        sb.calls.push(['oauth', provider, options]);
        return { data: { url: `https://project.supabase.test/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(options.redirectTo)}` }, error: null };
      },
      exchangeCodeForSession: async (code) => { sb.calls.push(['exchange', code]); sb.session = { user: USER }; return { error: null }; },
      signOut: async () => { sb.session = null; return { error: null }; },
      onAuthStateChange: (cb) => { sb.authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    rpc: async (name, args) => {
      sb.calls.push(['rpc', name, args]);
      if (sb.rpcReject) throw sb.rpcReject;
      if (sb.rpcError) return { data: null, error: sb.rpcError };
      // the retired trial function, as a not-yet-migrated project would still answer it
      if (name === 'entitlement') return { data: { plan: 'trial', trial_ends_at: new Date(NOW - DAY).toISOString(), server_time: new Date(NOW).toISOString(), active: false }, error: null };
      return { data: null, error: null };
    },
  };
  return sb;
}

// the best-effort "count users" call (#315)
const touches = (sb) => sb.calls.filter((c) => c[0] === 'rpc' && c[1] === 'touch_account');
// the touch may be fired without being awaited: let pending promises settle
const settle = () => new Promise((r) => setTimeout(r, 20));
// any truthy `error` anywhere in the account state
const hasError = (v) => !!v && typeof v === 'object' && Object.entries(v).some(([k, x]) => (k === 'error' && !!x) || hasError(x));

let nextPort = 47900 + Math.floor(Math.random() * 500);
function makeAuth(sb, opts = {}) {
  const storage = opts.storage || memStorage();
  const opened = [];
  const clock = opts.clock || (() => opts.now ?? NOW);
  const auth = createAuth({
    url: 'https://project.supabase.test', key: 'sb_publishable_test', storage, port: nextPort++, now: clock, appVersion: APP_VERSION,
    createClient: () => sb, openExternal: opts.openExternal || (async (u) => { opened.push(u); }), ...opts.auth,
  });
  return { auth, storage, opened };
}

// What the browser does after the provider and Supabase: comes back to the loopback server.
const browserReturns = (query) => async (authorizeUrl) => {
  const redirect = new URL(authorizeUrl).searchParams.get('redirect_to');
  await new Promise((resolve, reject) => http.get(`${redirect}?${query}`, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject));
};

test('without a Supabase project, sign-in is off and nobody is signed in', async () => {
  const off = createAuth({ url: '', key: '', required: false, storage: memStorage(), openExternal: async () => {} });
  assert.equal(off.state().configured, false);
  const s = await off.refresh();
  assert.equal(s.user, null);
  await assert.rejects(off.signIn('google'), /not configured/);
});

test('signs in through the browser and the loopback callback', async () => {
  const sb = fakeSupabase();
  const { auth } = makeAuth(sb, { openExternal: browserReturns('code=abc123') });
  const s = await auth.signIn('google');
  const [, provider, options] = sb.calls.find((c) => c[0] === 'oauth');
  assert.equal(provider, 'google');
  assert.equal(options.skipBrowserRedirect, true);
  assert.match(options.redirectTo, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.deepEqual(sb.calls.find((c) => c[0] === 'exchange'), ['exchange', 'abc123']);
  assert.equal(s.user.email, 'ana@example.com');
  assert.equal(s.user.name, 'Ana');
  assert.equal(s.signingIn, false);
});

test('a provider error on the callback fails the sign-in', async () => {
  const sb = fakeSupabase();
  const { auth } = makeAuth(sb, { openExternal: browserReturns('error=access_denied&error_description=User%20cancelled') });
  await assert.rejects(auth.signIn('google'), /Sign-in failed: User cancelled/);
  assert.equal(sb.calls.some((c) => c[0] === 'exchange'), false);
  assert.equal(auth.state().user, null);
});

test('sign-in can be cancelled, and disabled providers are refused', async () => {
  const sb = fakeSupabase();
  const { auth, opened } = makeAuth(sb);
  const p = auth.signIn('google');
  while (!opened.length) await new Promise((r) => setTimeout(r, 5));
  assert.equal(auth.state().signingIn, true);
  auth.cancelSignIn();
  await assert.rejects(p, /cancelled/);
  await assert.rejects(auth.signIn('github'), /GitHub is not available yet/);
  assert.deepEqual(auth.state().providers.map((x) => [x.id, x.enabled]), [['google', true], ['azure', false], ['github', false]]);
});

// ---- #315: free and open source: the account only counts users -------------------------------------

test('#315: packages/engine/domains/account/auth.js no longer exports the run gate nor the trial (assertCanRun, entitlementView, TRIAL_ENDED)', () => {
  const auth = require('../../domains/account/auth');
  for (const name of ['assertCanRun', 'entitlementView', 'TRIAL_ENDED']) assert.equal(name in auth, false, name);
  const instance = makeAuth(fakeSupabase()).auth;
  assert.equal('assertCanRun' in instance, false, 'createAuth() has no assertCanRun');
});

test('#315: the account state carries no trial, plan or days left', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const { auth } = makeAuth(sb);
  const s = await auth.refresh();
  assert.equal(s.user.email, 'ana@example.com');
  assert.doesNotMatch(JSON.stringify(s), /trial|daysLeft|"plan"/i);
});

test('#315: a start with a session touches the account once, with the app version and the platform', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const { auth } = makeAuth(sb);
  await auth.refresh();
  await settle();
  const t = touches(sb);
  assert.equal(t.length, 1);
  const args = t[0][2] || {};
  assert.equal(args.platform, process.platform);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')).version;
  assert.ok([APP_VERSION, pkgVersion].includes(args.app_version), `app_version: ${args.app_version}`);
});

test('#315: signing in touches the account once', async () => {
  const sb = fakeSupabase();
  const { auth } = makeAuth(sb, { openExternal: browserReturns('code=abc123') });
  await auth.signIn('google');
  await settle();
  assert.equal(touches(sb).length, 1);
});

test('#315: without a session nothing is touched', async () => {
  const sb = fakeSupabase();
  const { auth } = makeAuth(sb);
  await auth.refresh();
  await settle();
  assert.equal(touches(sb).length, 0);
});

test('#315: the account is touched at most once a day', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  let now = NOW;
  const { auth } = makeAuth(sb, { clock: () => now });
  await auth.refresh();
  await settle();
  now = NOW + 2 * HOUR;
  await auth.refresh();
  await settle();
  now = NOW + 20 * HOUR;
  await auth.refresh();
  await settle();
  assert.equal(touches(sb).length, 1, 'same day: one touch');
  now = NOW + DAY + HOUR;
  await auth.refresh();
  await settle();
  assert.equal(touches(sb).length, 2, 'a day later: touched again');
});

test('#315: a failing touch (an error answer) is swallowed: still signed in, no error shown', async () => {
  const sb = fakeSupabase({ session: { user: USER }, rpcError: { message: 'function touch_account does not exist' } });
  const { auth } = makeAuth(sb);
  const s = await auth.refresh();
  await settle();
  assert.equal(touches(sb).length, 1);
  assert.equal(s.user.email, 'ana@example.com');
  assert.equal(hasError(auth.state()), false);
});

test('#315: a rejected touch (account server unreachable) is swallowed: still signed in, no error shown', async () => {
  const sb = fakeSupabase({ session: { user: USER }, rpcReject: new Error('fetch failed') });
  const { auth } = makeAuth(sb);
  const s = await auth.refresh();
  await settle();
  assert.equal(touches(sb).length, 1);
  assert.equal(s.user.email, 'ana@example.com');
  assert.equal(hasError(auth.state()), false);
});

test('#315: an offline start with a stored session signs in, however long the app was offline', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const storage = memStorage();
  await makeAuth(sb, { storage }).auth.refresh();
  await settle();

  // a month later the account server cannot be reached at all
  sb.sessionError = new Error('fetch failed');
  sb.rpcReject = new Error('fetch failed');
  const { auth } = makeAuth(sb, { storage, now: NOW + 30 * DAY });
  const s = await auth.refresh();
  await settle();
  assert.equal(s.user?.email, 'ana@example.com');
  assert.equal(hasError(auth.state()), false);
});

// The Electron host touches at start, then every 24 hours from that start; reloading the session
// takes a moment (longer at start, when the token is refreshed over a cold connection), so each
// touch is recorded a little after the host asked for it.
test('#315: a host that refreshes every 24 hours touches the account every day', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  let now = NOW;
  let reloads = 0;
  sb.beforeGetSession = () => { now += reloads++ === 0 ? 3000 : 200; }; // 3 s at start, then 200 ms
  const { auth } = makeAuth(sb, { clock: () => now });
  await auth.refresh();
  await settle();
  for (let day = 1; day <= 3; day++) {
    now = NOW + day * DAY;
    await auth.refresh();
    await settle();
    assert.equal(touches(sb).length, day + 1, `day ${day}: touched again`);
  }
});

test('#315: a start that finds no session forgets the stored user: a later offline start stays signed out', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const storage = memStorage();
  await makeAuth(sb, { storage }).auth.refresh();
  await settle();

  // the session expired: the account server answers, with no session
  sb.session = null;
  const reached = await makeAuth(sb, { storage }).auth.refresh();
  assert.equal(reached.user, null);

  // then a start offline
  sb.sessionError = new Error('fetch failed');
  const { auth } = makeAuth(sb, { storage });
  const s = await auth.refresh();
  await settle();
  assert.equal(s.user, null);
  assert.equal(touches(sb).length, 1, 'only the first, signed-in start touched');
});

test('#315: a sign-out reported by the account server forgets the stored user', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const storage = memStorage();
  const { auth } = makeAuth(sb, { storage });
  await auth.refresh();
  await settle();
  const seen = [];
  auth.onChange((s) => seen.push(s.user === null));
  sb.session = null;
  for (const cb of sb.authListeners) cb('SIGNED_OUT', null);
  assert.equal(auth.state().user, null);
  assert.deepEqual(seen, [true]);

  sb.sessionError = new Error('fetch failed');
  const offline = await makeAuth(sb, { storage }).auth.refresh();
  assert.equal(offline.user, null);
});

test('signing out drops the session and what the account stored', async () => {
  const sb = fakeSupabase({ session: { user: USER } });
  const { auth, storage } = makeAuth(sb);
  await auth.refresh();
  await settle();
  const s = await auth.signOut();
  assert.equal(s.user, null);
  assert.equal(storage.m.size, 0);
});

test('fileStorage keeps the values encrypted on disk and survives a corrupt file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sub', 'account.bin');
  const xor = (b) => Buffer.from(b).map((x) => x ^ 0x5a);
  const opts = { encrypt: (s) => xor(Buffer.from(s, 'utf8')), decrypt: (b) => xor(b).toString('utf8') };
  fileStorage(file, opts).setItem('token', 'secret-value');
  assert.equal(fs.readFileSync(file).includes('secret-value'), false);
  assert.equal(fileStorage(file, opts).getItem('token'), 'secret-value');
  fs.writeFileSync(file, 'garbage');
  assert.equal(fileStorage(file, opts).getItem('token'), null);
});
