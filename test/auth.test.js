const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createAuth, fileStorage, entitlementView, TRIAL_ENDED } = require('../src/auth');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const USER = { id: 'u1', email: 'ana@example.com', user_metadata: { full_name: 'Ana' }, app_metadata: { providers: ['google'] } };

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
};

// Stand-in for the supabase-js client: `session` and the `entitlement()` answer are set by the test.
function fakeSupabase({ session = null, entitlement = null, rpcError = null, sessionError = null } = {}) {
  const sb = {
    session, entitlement, rpcError, sessionError, calls: [],
    auth: {
      getSession: async () => (sb.sessionError ? { data: { session: null }, error: sb.sessionError } : { data: { session: sb.session }, error: null }),
      signInWithOAuth: async ({ provider, options }) => {
        sb.calls.push(['oauth', provider, options]);
        return { data: { url: `https://project.supabase.test/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(options.redirectTo)}` }, error: null };
      },
      exchangeCodeForSession: async (code) => { sb.calls.push(['exchange', code]); sb.session = { user: USER }; return { error: null }; },
      signOut: async () => { sb.session = null; return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (name) => {
      sb.calls.push(['rpc', name]);
      return sb.rpcError ? { data: null, error: sb.rpcError } : { data: sb.entitlement, error: null };
    },
  };
  return sb;
}

const trial = (daysLeft, plan = 'trial') => ({
  plan, trial_ends_at: new Date(NOW + daysLeft * DAY).toISOString(), server_time: new Date(NOW).toISOString(), active: plan === 'pro' || daysLeft > 0,
});

let nextPort = 47900 + Math.floor(Math.random() * 500);
function makeAuth(sb, opts = {}) {
  const storage = opts.storage || memStorage();
  const opened = [];
  const auth = createAuth({
    url: 'https://project.supabase.test', key: 'sb_publishable_test', storage, port: nextPort++, now: () => opts.now ?? NOW,
    createClient: () => sb, openExternal: opts.openExternal || (async (u) => { opened.push(u); }), ...opts.auth,
  });
  return { auth, storage, opened };
}

// What the browser does after the provider and Supabase: comes back to the loopback server.
const browserReturns = (query) => async (authorizeUrl) => {
  const redirect = new URL(authorizeUrl).searchParams.get('redirect_to');
  await new Promise((resolve, reject) => http.get(`${redirect}?${query}`, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject));
};

test('without a Supabase project, sign-in is off and only a required build refuses runs', async () => {
  const off = createAuth({ url: '', key: '', required: false, storage: memStorage(), openExternal: async () => {} });
  assert.equal(off.state().configured, false);
  await off.assertCanRun({ mock: false });
  const packaged = createAuth({ url: '', key: '', required: true, storage: memStorage(), openExternal: async () => {} });
  await assert.rejects(packaged.assertCanRun({ mock: false }), /not configured/);
  await packaged.assertCanRun({ mock: true }); // simulations never need an account
});

test('signs in through the browser and the loopback callback, then loads the trial', async () => {
  const sb = fakeSupabase({ entitlement: trial(7) });
  const { auth } = makeAuth(sb, { openExternal: browserReturns('code=abc123') });
  const s = await auth.signIn('google');
  const [, provider, options] = sb.calls.find((c) => c[0] === 'oauth');
  assert.equal(provider, 'google');
  assert.equal(options.skipBrowserRedirect, true);
  assert.match(options.redirectTo, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.deepEqual(sb.calls.find((c) => c[0] === 'exchange'), ['exchange', 'abc123']);
  assert.equal(s.user.email, 'ana@example.com');
  assert.equal(s.user.name, 'Ana');
  assert.deepEqual([s.entitlement.plan, s.entitlement.active, s.entitlement.daysLeft], ['trial', true, 7]);
  assert.equal(s.signingIn, false);
  await auth.assertCanRun({ mock: false });
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

test('an ended trial blocks real runs but not simulations; pro is always allowed', async () => {
  const sb = fakeSupabase({ session: { user: USER }, entitlement: trial(-1) });
  const { auth } = makeAuth(sb);
  await auth.refresh();
  assert.deepEqual([auth.state().entitlement.active, auth.state().entitlement.daysLeft], [false, 0]);
  await assert.rejects(auth.assertCanRun({ mock: false }), (e) => e.message === TRIAL_ENDED);
  await auth.assertCanRun({ mock: true });
  sb.entitlement = trial(-30, 'pro');
  await auth.assertCanRun({ mock: false });
  assert.equal(auth.state().entitlement.daysLeft, null);
});

test('without a session, runs ask to sign in', async () => {
  const { auth } = makeAuth(fakeSupabase());
  await assert.rejects(auth.assertCanRun({ mock: false }), /Sign in to start runs/);
});

test('offline, the last entitlement is trusted for 3 days', async () => {
  const sb = fakeSupabase({ session: { user: USER }, entitlement: trial(5) });
  const storage = memStorage();
  await makeAuth(sb, { storage }).auth.refresh();

  // the account server is down, one day later
  sb.rpcError = new Error('fetch failed');
  const later = makeAuth(sb, { storage, now: NOW + DAY }).auth;
  await later.refresh();
  assert.deepEqual([later.state().entitlement.active, later.state().entitlement.offline, later.state().entitlement.daysLeft], [true, true, 4]);

  // the session can't be refreshed either: the last known user is kept
  sb.sessionError = new Error('fetch failed');
  const noSession = makeAuth(sb, { storage, now: NOW + DAY }).auth;
  await noSession.refresh();
  assert.equal(noSession.state().user.email, 'ana@example.com');
  await noSession.assertCanRun({ mock: false });

  // past the grace period
  const tooLate = makeAuth(sb, { storage, now: NOW + 4 * DAY }).auth;
  await tooLate.refresh();
  assert.match(tooLate.state().entitlement.error, /Could not reach the account server/);
  await assert.rejects(tooLate.assertCanRun({ mock: false }), /Could not reach the account server/);
});

test('signing out drops the session and the cached entitlement', async () => {
  const sb = fakeSupabase({ session: { user: USER }, entitlement: trial(3) });
  const { auth, storage } = makeAuth(sb);
  await auth.refresh();
  assert.ok(storage.m.size);
  const s = await auth.signOut();
  assert.equal(s.user, null);
  assert.equal(storage.m.size, 0);
});

test('the days left follow the server clock, not the local one', () => {
  // the local clock is 10 days ahead of the server's
  const e = { ...trial(2), checked_at: NOW + 10 * DAY };
  const v = entitlementView(e, NOW + 10 * DAY + DAY / 2);
  assert.deepEqual([v.active, v.daysLeft], [true, 2]);
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
