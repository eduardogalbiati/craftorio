-- Accounts and the 7-day free trial.
-- Apply once: Supabase dashboard > SQL Editor > paste this file > Run (or `supabase db push`).
--
-- Every new user (first sign-in with any provider) gets an account row whose trial ends 7 days
-- later. Users can only read their own row; nothing on the client can write it (no insert/update
-- policies): plans change only from the dashboard or a server-side function.

create table if not exists public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  trial_ends_at timestamptz not null default now() + interval '7 days',
  plan text not null default 'trial' check (plan in ('trial', 'pro'))
);

alter table public.accounts enable row level security;

drop policy if exists "Users read their own account" on public.accounts;
create policy "Users read their own account" on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Creates the account when Supabase creates the user. Linking another provider with the same
-- verified email reuses the user, so it does not start a new trial.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users created before this migration
insert into public.accounts (user_id) select id from auth.users on conflict (user_id) do nothing;

-- What the signed-in user may do, computed with the server's clock (the app's clock can't be
-- trusted). Returns null when there is no account row.
create or replace function public.entitlement()
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'plan', a.plan,
    'trial_ends_at', a.trial_ends_at,
    'server_time', now(),
    'active', a.plan = 'pro' or a.trial_ends_at > now()
  )
  from public.accounts a
  where a.user_id = (select auth.uid());
$$;

revoke all on function public.entitlement() from public, anon;
grant execute on function public.entitlement() to authenticated;
