-- Newsletter of the build-in-public page (site/24x7/).
-- Apply once: Supabase dashboard > SQL Editor > paste this file > Run (or `supabase db push`).
--
-- The same model as the waitlist: the page calls public.join_newsletter() with the publishable key
-- (role anon); the table has row level security and no policies, so nothing on the client can read
-- or change it. The list is read from the dashboard (Table Editor > newsletter, or export to CSV).

create table if not exists public.newsletter (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text check (name is null or char_length(name) between 2 and 120),
  email text not null unique check (char_length(email) between 5 and 254 and email = lower(email)),
  -- where the sign-up came from: utm_* parameters and the referrer, as sent by the page
  source text check (char_length(source) <= 500),
  consent_at timestamptz not null default now()
);

alter table public.newsletter enable row level security;

-- Adds a subscriber. An email already subscribed is ignored (not updated), and the answer is the
-- same either way: the page can't be used to find out who subscribed. The name is optional.
-- Invalid input raises an error whose message starts with "invalid_".
create or replace function public.join_newsletter(p_name text, p_email text, p_source text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_name is not null and char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_email) not between 5 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  insert into public.newsletter (name, email, source)
  values (v_name, v_email, left(p_source, 500))
  on conflict (email) do nothing;
end;
$$;

revoke all on function public.join_newsletter(text, text, text) from public;
grant execute on function public.join_newsletter(text, text, text) to anon, authenticated;
