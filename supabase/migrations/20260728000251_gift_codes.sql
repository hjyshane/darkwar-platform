-- 0251: gift codes - the codes an officer keeps, who each one is to be claimed
-- for, and what happened to every (code, member) pair.
--
-- The game has no code box. A code is redeemed on the official Gift Center web
-- page by logging in with a player ID, and the reward arrives in that player's
-- in-game mail. So "claim a code for the alliance" is a list of (code, player
-- id) pairs worked through one at a time by a local worker (gift/ in the
-- collector), not anything the game's own protocol does.
--
--   * gift_codes: the codes. GLOBAL - a code is the same code for every
--     alliance - read by anyone holding `giftcodes.manage`. Case-sensitive, and
--     shaped like the ones seen (letters and digits only): it ends up in a web
--     request, so the shape is checked here rather than trusted.
--   * gift_code_claims: one row per (code, player id) - the work queue AND the
--     record of its outcome. Per alliance, so one alliance's officers never see
--     another's. `status` is deliberately a small fixed vocabulary of OUR OWN:
--     the Gift Center's responses have not been seen, so what it said is kept
--     verbatim in `result` and mapped to a status by the worker, where a wrong
--     guess costs a parser fix and not a migration.
--   * gift_claim_exclusions: players who are never claimed for. The default is
--     the whole roster; leaving someone out is the exception, and it holds even
--     when an officer ticks them by hand.
--
-- No direct writes from a browser: every write is a function that checks the
-- capability first. The worker writes as the service role.
--
-- A capability, not enumerated roles (cf. 0250): officers and admins hold it by
-- default, and an admin can move it, which is the point of the registry (0045).

insert into public.capabilities (capability, label, description, sort_order) values
  ('giftcodes.manage', 'Manage gift codes',
   'Add gift codes and queue them to be claimed for the alliance''s members.', 140);

insert into public.role_permissions (role, capability, allowed)
select r.role, 'giftcodes.manage', r.role in ('officer', 'admin')
from (values ('viewer'::public.app_role), ('member'), ('officer'), ('admin')) as r(role);

create table public.gift_codes (
  code_id uuid primary key default gen_random_uuid(),
  code text not null,
  status text not null default 'unverified'
    check (status in ('unverified', 'working', 'expired', 'invalid')),
  source text not null default 'officer' check (source in ('officer', 'scan')),
  added_by uuid default auth.uid(),
  first_seen_at timestamptz not null default now(),
  checked_at timestamptz,
  note text,
  constraint gift_codes_code_key unique (code),
  constraint gift_codes_code_shape check (code ~ '^[A-Za-z0-9]{3,32}$')
);

create table public.gift_code_claims (
  claim_id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.gift_codes (code_id) on delete cascade,
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  game_uid bigint not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'already', 'expired', 'invalid',
                      'failed', 'cancelled')),
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  -- What the Gift Center answered, verbatim.
  result jsonb,
  requested_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint gift_code_claims_key unique (code_id, game_uid)
);

-- The worker's one query: what is queued and due.
create index gift_code_claims_due_idx
  on public.gift_code_claims (next_attempt_at) where status = 'queued';
create index gift_code_claims_alliance_idx
  on public.gift_code_claims (alliance_id, code_id);

create table public.gift_claim_exclusions (
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  game_uid bigint not null,
  excluded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (alliance_id, game_uid)
);

alter table public.gift_codes enable row level security;
alter table public.gift_code_claims enable row level security;
alter table public.gift_claim_exclusions enable row level security;

-- revoke-then-grant: the hosted default privileges hand authenticated
-- everything, TRUNCATE included (0207). Reads only; every write is a function.
revoke all on public.gift_codes from anon, authenticated;
revoke all on public.gift_code_claims from anon, authenticated;
revoke all on public.gift_claim_exclusions from anon, authenticated;
grant select on public.gift_codes to authenticated;
grant select on public.gift_code_claims to authenticated;
grant select on public.gift_claim_exclusions to authenticated;
-- 0006's blanket grant to service_role was point-in-time: grant explicitly.
grant all on public.gift_codes to service_role;
grant all on public.gift_code_claims to service_role;
grant all on public.gift_claim_exclusions to service_role;

create policy manager_read on public.gift_codes
  for select to authenticated
  using ((select public.has_permission('giftcodes.manage')));

create policy manager_read on public.gift_code_claims
  for select to authenticated
  using ((select public.has_permission('giftcodes.manage')));
create policy alliance_scope on public.gift_code_claims as restrictive
  for select to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()));

create policy manager_read on public.gift_claim_exclusions
  for select to authenticated
  using ((select public.has_permission('giftcodes.manage')));
create policy alliance_scope on public.gift_claim_exclusions as restrictive
  for select to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()));

comment on table public.gift_codes is
  'Gift codes (0251). Global; case-sensitive; letters and digits only. Written only '
  'through add_gift_code() / set_gift_code_status() and by the worker.';
comment on table public.gift_code_claims is
  'One row per (code, player id): the work queue and the record of its outcome (0251). '
  '`result` is the Gift Center''s answer verbatim; `status` is our own vocabulary.';
comment on table public.gift_claim_exclusions is
  'Players never claimed for (0251). The default is the whole roster.';

-- ---------------------------------------------------------------------------
-- Writes. Each starts with the capability check, BEFORE any write: a RAISE
-- rolls back everything the function did in that call (CLAUDE.md), which is
-- harmless here only because nothing has been written yet.

create function public.add_gift_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_id uuid;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Za-z0-9]{3,32}$' then
    raise exception 'a gift code is 3 to 32 letters and digits' using errcode = '22023';
  end if;

  insert into public.gift_codes (code) values (v_code)
  on conflict (code) do nothing
  returning code_id into v_id;

  -- Already known: hand back the existing one rather than an error, so adding
  -- a code twice is not a mistake worth reporting.
  if v_id is null then
    select g.code_id into v_id from public.gift_codes g where g.code = v_code;
  end if;
  return v_id;
end;
$$;

create function public.set_gift_code_status(p_code_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if p_status not in ('unverified', 'working', 'expired', 'invalid') then
    raise exception 'unknown gift code status' using errcode = '22023';
  end if;
  update public.gift_codes set status = p_status where code_id = p_code_id;
end;
$$;

create function public.set_gift_exclusion(p_game_uid bigint, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance on screen' using errcode = '22023';
  end if;

  if p_excluded then
    insert into public.gift_claim_exclusions (alliance_id, game_uid)
    values (v_alliance, p_game_uid)
    on conflict (alliance_id, game_uid) do nothing;
    -- Whatever of theirs is still waiting goes with it.
    update public.gift_code_claims
       set status = 'cancelled', finished_at = now()
     where alliance_id = v_alliance and game_uid = p_game_uid and status = 'queued';
  else
    delete from public.gift_claim_exclusions
     where alliance_id = v_alliance and game_uid = p_game_uid;
  end if;
end;
$$;

-- Queue the codes for the alliance on screen: its whole current roster, or the
-- players named. Exclusions hold either way. A pair already done (or "already
-- claimed") is left alone; one that failed or was cancelled is queued afresh.
-- Returns how many pairs were queued.
create function public.enqueue_gift_claims(p_code_ids uuid[], p_game_uids bigint[] default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_count int;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance on screen' using errcode = '22023';
  end if;
  if coalesce(array_length(p_code_ids, 1), 0) = 0 or array_length(p_code_ids, 1) > 50 then
    raise exception 'name between 1 and 50 codes' using errcode = '22023';
  end if;
  if p_game_uids is not null and array_length(p_game_uids, 1) > 500 then
    raise exception 'name at most 500 players' using errcode = '22023';
  end if;

  with targets as (
    select r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id = v_alliance
       and (p_game_uids is null or r.game_uid = any (p_game_uids))
       and not exists (
         select 1 from public.gift_claim_exclusions x
          where x.alliance_id = v_alliance and x.game_uid = r.game_uid)
  ),
  usable as (
    select g.code_id from public.gift_codes g
     where g.code_id = any (p_code_ids) and g.status in ('unverified', 'working')
  ),
  queued as (
    insert into public.gift_code_claims (code_id, alliance_id, game_uid, requested_by)
    select u.code_id, v_alliance, t.game_uid, auth.uid()
      from usable u cross join targets t
    on conflict (code_id, game_uid) do update
      set status = 'queued', attempt_count = 0, next_attempt_at = now(),
          started_at = null, finished_at = null, last_error = null
      where public.gift_code_claims.status in ('failed', 'cancelled')
        and public.gift_code_claims.alliance_id = v_alliance
    returning 1
  )
  select count(*)::int into v_count from queued;
  return v_count;
end;
$$;

create function public.cancel_gift_claims(p_code_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_count int;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  with c as (
    update public.gift_code_claims
       set status = 'cancelled', finished_at = now()
     where code_id = p_code_id and alliance_id = v_alliance and status = 'queued'
    returning 1
  )
  select count(*)::int into v_count from c;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads for the screen, one row per CODE and one row per PERSON: a query that
-- returned a row per (code, member) would be 544 rows for a 68-member alliance
-- and 8 codes and would meet PostgREST's 1,000-row cap one code later, silently
-- dropping people (CLAUDE.md: 0144, 0147).

create function public.gift_code_progress()
returns table (
  code_id uuid,
  code text,
  status text,
  source text,
  first_seen_at timestamptz,
  checked_at timestamptz,
  members int,
  queued int,
  running int,
  done int,
  already int,
  failed int,
  other int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with roster as (
    select count(*)::int as members
      from public.alliance_roster_latest r
     where r.alliance_id = (select public.active_alliance())
       and not exists (
         select 1 from public.gift_claim_exclusions x
          where x.alliance_id = r.alliance_id and x.game_uid = r.game_uid)
  )
  select g.code_id, g.code, g.status, g.source, g.first_seen_at, g.checked_at,
         (select members from roster),
         count(*) filter (where c.status = 'queued')::int,
         count(*) filter (where c.status = 'running')::int,
         count(*) filter (where c.status = 'done')::int,
         count(*) filter (where c.status = 'already')::int,
         count(*) filter (where c.status = 'failed')::int,
         count(*) filter (where c.status in ('expired', 'invalid', 'cancelled'))::int
    from public.gift_codes g
    left join public.gift_code_claims c
           on c.code_id = g.code_id
          and c.alliance_id = (select public.active_alliance())
   group by g.code_id
   order by g.first_seen_at desc;
$$;

create function public.gift_member_status()
returns table (
  game_uid bigint,
  name text,
  excluded boolean,
  claims jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.game_uid,
         r.name,
         exists (select 1 from public.gift_claim_exclusions x
                  where x.alliance_id = r.alliance_id and x.game_uid = r.game_uid),
         coalesce((select jsonb_object_agg(c.code_id::text, c.status)
                     from public.gift_code_claims c
                    where c.alliance_id = r.alliance_id and c.game_uid = r.game_uid),
                  '{}'::jsonb)
    from public.alliance_roster_latest r
   where r.alliance_id = (select public.active_alliance())
   order by r.name;
$$;

-- Postgres grants EXECUTE to PUBLIC at creation, and the hosted default
-- privileges hand it to anon as well (0207): revoke both by name, then grant.
revoke all on function public.add_gift_code(text) from public, anon, authenticated;
revoke all on function public.set_gift_code_status(uuid, text) from public, anon, authenticated;
revoke all on function public.set_gift_exclusion(bigint, boolean) from public, anon, authenticated;
revoke all on function public.enqueue_gift_claims(uuid[], bigint[]) from public, anon, authenticated;
revoke all on function public.cancel_gift_claims(uuid) from public, anon, authenticated;
revoke all on function public.gift_code_progress() from public, anon, authenticated;
revoke all on function public.gift_member_status() from public, anon, authenticated;

grant execute on function public.add_gift_code(text) to authenticated, service_role;
grant execute on function public.set_gift_code_status(uuid, text) to authenticated, service_role;
grant execute on function public.set_gift_exclusion(bigint, boolean) to authenticated, service_role;
grant execute on function public.enqueue_gift_claims(uuid[], bigint[]) to authenticated, service_role;
grant execute on function public.cancel_gift_claims(uuid) to authenticated, service_role;
grant execute on function public.gift_code_progress() to authenticated, service_role;
grant execute on function public.gift_member_status() to authenticated, service_role;

comment on function public.enqueue_gift_claims(uuid[], bigint[]) is
  'Queue codes for the alliance on screen (0251): its whole current roster, or the '
  'players named; exclusions hold either way. Done pairs are left alone, failed or '
  'cancelled ones are queued afresh. Returns the number of pairs queued.';
comment on function public.gift_code_progress() is
  'One row per code with its counts for the alliance on screen (0251).';
comment on function public.gift_member_status() is
  'One row per roster member with a {code_id: status} map (0251): a row per person, '
  'never per (code, member), so PostgREST''s row cap cannot drop anyone.';
