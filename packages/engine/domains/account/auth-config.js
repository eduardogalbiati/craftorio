// Public settings of the accounts backend (Supabase). The publishable key is meant to ship inside
// clients: what it can reach is limited by row level security (see supabase/migrations). Provider
// client secrets live only in the Supabase dashboard, never here.
//
// In development (not packaged) CRAFTORIO_SUPABASE_URL / CRAFTORIO_SUPABASE_KEY override these,
// and CRAFTORIO_AUTH=off disables sign-in (tests, UI smoke). The packaged app ignores them.
//
// `enabled: false` turns sign-in off everywhere, the packaged app and the server included: no sign-in
// screen, no Supabase client, nothing recorded. Set it back to true to ask for the account again.

module.exports = {
  enabled: false,
  url: 'https://grguuqxwdqxighfzurgh.supabase.co',
  publishableKey: 'sb_publishable_AyKeR5ap4awlLc2d7OBCQw_sQp_lwV7',
  // providers enabled in the Supabase dashboard; the others show as "coming soon"
  providers: ['google'],
};
