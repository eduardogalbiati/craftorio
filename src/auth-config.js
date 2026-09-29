// Public settings of the accounts backend (Supabase). The publishable key is meant to ship inside
// clients: what it can reach is limited by row level security (see supabase/migrations). Provider
// client secrets live only in the Supabase dashboard, never here.
//
// In development (not packaged) MULTIAGENT_SUPABASE_URL / MULTIAGENT_SUPABASE_KEY override these,
// and MULTIAGENT_AUTH=off disables sign-in (tests, UI smoke). The packaged app ignores them.

module.exports = {
  url: 'https://grguuqxwdqxighfzurgh.supabase.co',
  publishableKey: 'sb_publishable_AyKeR5ap4awlLc2d7OBCQw_sQp_lwV7',
  // providers enabled in the Supabase dashboard; the others show as "coming soon"
  providers: ['google'],
};
