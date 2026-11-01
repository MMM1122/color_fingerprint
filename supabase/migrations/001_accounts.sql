-- Color Fingerprint: accounts and synced fingerprints.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste this file → Run.
-- Safe to run again: every statement checks before creating.

-- One saved fingerprint per account. `data` is the same JSON the site already saves locally
-- (schemaVersion, sessions with answers, anchors, consistency, patterns, flags).
-- No audio, microphone or camera data is ever stored.
create table if not exists public.fingerprints (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  schema_version int not null default 1,
  updated_at timestamptz not null default now(),
  -- A full fingerprint is a few tens of KB; this cap blocks abuse of the free tier.
  constraint fingerprint_size check (octet_length(data::text) < 1000000)
);

-- Keep updated_at current on every write.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fingerprints_touch on public.fingerprints;
create trigger fingerprints_touch
  before update on public.fingerprints
  for each row execute function public.touch_updated_at();

-- Row-level security: each signed-in person can read and change only their own row.
-- Nobody, including other signed-in users, can list or read anyone else's data.
alter table public.fingerprints enable row level security;

drop policy if exists "read own fingerprint" on public.fingerprints;
create policy "read own fingerprint" on public.fingerprints
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "insert own fingerprint" on public.fingerprints;
create policy "insert own fingerprint" on public.fingerprints
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "update own fingerprint" on public.fingerprints;
create policy "update own fingerprint" on public.fingerprints
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "delete own fingerprint" on public.fingerprints;
create policy "delete own fingerprint" on public.fingerprints
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get no access at all.
revoke all on public.fingerprints from anon;

-- Let people delete their own account (and, through the cascade, their data) from the site.
-- Runs with the owner's rights but can only ever delete the caller's own user.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
