-- No more trial: the account only counts the people using the app (#315).
-- Apply once: Supabase dashboard > SQL Editor > paste this file > Run (or `supabase db push`).
--
-- The signed-in app calls touch_account() at every start and then at most once a day. It records
-- when the user was last seen, the app version and the OS. Nothing else is stored: no code,
-- prompts, runs or usage. The old trial columns (trial_ends_at, plan) stay, so no data is lost,
-- but nothing reads them any more. The app works before this file is applied: the call to the
-- missing function just fails, and that failure is only logged.

alter table public.accounts add column if not exists last_seen_at timestamptz;
alter table public.accounts add column if not exists app_version text;
alter table public.accounts add column if not exists platform text;

-- Records the visit of the signed-in user, on their own row only (created when missing).
create or replace function public.touch_account(app_version text, platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  insert into public.accounts (user_id, last_seen_at, app_version, platform)
  values ((select auth.uid()), now(), left(touch_account.app_version, 40), left(touch_account.platform, 20))
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at,
        app_version = excluded.app_version,
        platform = excluded.platform;
end;
$$;

revoke all on function public.touch_account(text, text) from public, anon;
grant execute on function public.touch_account(text, text) to authenticated;

-- The trial's entitlement check is gone: nothing gates the app any more.
drop function if exists public.entitlement();

-- How many people use the app (run it in the SQL Editor):
-- select
--   count(*) as accounts,
--   count(*) filter (where last_seen_at > now() - interval '7 days') as active_last_7_days,
--   count(*) filter (where last_seen_at > now() - interval '30 days') as active_last_30_days
-- from public.accounts;
--
-- By platform and by app version (people active in the last 30 days):
-- select platform, app_version, count(*) as people
-- from public.accounts
-- where last_seen_at > now() - interval '30 days'
-- group by platform, app_version
-- order by people desc;
