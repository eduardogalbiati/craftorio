-- Waitlist of the landing page (site/).
-- Apply once: Supabase dashboard > SQL Editor > paste this file > Run (or `supabase db push`).
--
-- The page calls public.join_waitlist() with the publishable key (role anon). The table has row
-- level security and no policies, so nothing on the client can read or change it: the list is
-- read only from the dashboard (Table Editor > waitlist, or export to CSV).

create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null unique check (char_length(email) between 5 and 254 and email = lower(email)),
  phone text not null check (phone ~ '^\+[0-9]{10,15}$'),
  -- where the sign-up came from: utm_* parameters and the referrer, as sent by the page
  source text check (char_length(source) <= 500),
  consent_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Adds a sign-up. An email already on the list is ignored (not updated), and the answer is the
-- same either way: the page can't be used to find out who signed up, or to overwrite someone's
-- phone. Invalid input raises an error whose message starts with "invalid_".
create or replace function public.join_waitlist(p_name text, p_email text, p_phone text, p_source text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  -- keep the digits; a number without a country code is taken as Brazilian (+55)
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text;
begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_email) not between 5 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;
  if btrim(coalesce(p_phone, '')) !~ '^\+' and char_length(v_digits) in (10, 11) then
    v_digits := '55' || v_digits;
  end if;
  v_phone := '+' || v_digits;
  if v_phone !~ '^\+[0-9]{10,15}$' then
    raise exception 'invalid_phone';
  end if;

  insert into public.waitlist (name, email, phone, source)
  values (v_name, v_email, v_phone, left(p_source, 500))
  on conflict (email) do nothing;
end;
$$;

revoke all on function public.join_waitlist(text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text) to anon, authenticated;
