-- 0255: players that are not in the alliance, kept as a list of player IDs.
--
-- Gift codes were claimed only for the roster. An officer can now save player
-- IDs of their own (friends, alts, other alliances) and claim codes for them
-- the same way: they are queued, paced and recorded like any roster member.
--
--   * gift_extra_players: the saved list, per alliance. Written only by the
--     functions below (giftcodes.manage), read by the same capability.
--   * enqueue_gift_claims: "everyone" is now the roster AND the saved list;
--     named players may be from either. Exclusions hold for both.
--   * gift_code_progress counts them in `members`, so "not asked" stays right.
--   * gift_member_status lists them (`extra = true`), after the roster. Its
--     return type gains a column, hence drop and create.
--
-- Every UPDATE/DELETE carries a WHERE (hosted pg_safeupdate, 0253).

create table public.gift_extra_players (
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  game_uid bigint not null check (game_uid between 1000000000 and 9223372036854775807),
  label text check (label is null or char_length(label) <= 40),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (alliance_id, game_uid)
);

alter table public.gift_extra_players enable row level security;
revoke all on public.gift_extra_players from anon, authenticated;
grant select on public.gift_extra_players to authenticated;
grant all on public.gift_extra_players to service_role;

create policy manager_read on public.gift_extra_players
  for select to authenticated
  using ((select public.has_permission('giftcodes.manage')));
create policy alliance_scope on public.gift_extra_players as restrictive
  for select to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()));

comment on table public.gift_extra_players is
  'Player IDs saved for gift-code claims beyond the alliance roster (0255). Per alliance.';

-- Save player IDs. A label is kept only when exactly one ID is given. IDs
-- already saved, or already on the roster, are skipped. Returns how many were
-- newly saved.
create function public.add_gift_extra_players(p_uids bigint[], p_label text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid := public.active_alliance();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_count int;
begin
  if not public.has_permission('giftcodes.manage') then
    raise exception 'not allowed to manage gift codes' using errcode = '42501';
  end if;
  if v_alliance is null then
    raise exception 'no alliance on screen' using errcode = '22023';
  end if;
  if coalesce(array_length(p_uids, 1), 0) = 0 or array_length(p_uids, 1) > 200 then
    raise exception 'give between 1 and 200 player IDs' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_uids) u
              where u is null or u < 1000000000) then
    raise exception 'a player ID is at least 10 digits' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 40 then
    raise exception 'a label is at most 40 characters' using errcode = '22023';
  end if;

  with ins as (
    insert into public.gift_extra_players (alliance_id, game_uid, label, added_by)
    select v_alliance, u.game_uid,
           case when array_length(p_uids, 1) = 1 then v_label end,
           auth.uid()
      from (select distinct x as game_uid from unnest(p_uids) x) u
     where not exists (
       select 1 from public.alliance_roster_latest r
        where r.alliance_id = v_alliance and r.game_uid = u.game_uid)
    on conflict (alliance_id, game_uid) do nothing
    returning 1
  )
  select count(*)::int into v_count from ins;
  return v_count;
end;
$$;

-- Take a saved ID off the list, and cancel whatever of theirs is still waiting.
create function public.remove_gift_extra_player(p_game_uid bigint)
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

  delete from public.gift_extra_players
   where alliance_id = v_alliance and game_uid = p_game_uid;
  delete from public.gift_claim_exclusions
   where alliance_id = v_alliance and game_uid = p_game_uid;
  update public.gift_code_claims
     set status = 'cancelled', finished_at = now()
   where alliance_id = v_alliance and game_uid = p_game_uid and status = 'queued';
end;
$$;

-- Queue for the alliance on screen: its roster and its saved list, or the
-- players named from either. Exclusions hold for both.
create or replace function public.enqueue_gift_claims(p_code_ids uuid[], p_game_uids bigint[] default null)
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

  with people as (
    select r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id = v_alliance
    union
    select e.game_uid
      from public.gift_extra_players e
     where e.alliance_id = v_alliance
  ),
  targets as (
    select p.game_uid
      from people p
     where (p_game_uids is null or p.game_uid = any (p_game_uids))
       and not exists (
         select 1 from public.gift_claim_exclusions x
          where x.alliance_id = v_alliance and x.game_uid = p.game_uid)
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

create or replace function public.gift_code_progress()
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
  with people as (
    select r.game_uid
      from public.alliance_roster_latest r
     where r.alliance_id = (select public.active_alliance())
    union
    select e.game_uid
      from public.gift_extra_players e
     where e.alliance_id = (select public.active_alliance())
  ),
  roster as (
    select count(*)::int as members
      from people p
     where not exists (
       select 1 from public.gift_claim_exclusions x
        where x.alliance_id = (select public.active_alliance()) and x.game_uid = p.game_uid)
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

drop function public.gift_member_status();
create function public.gift_member_status()
returns table (
  game_uid bigint,
  name text,
  excluded boolean,
  claims jsonb,
  extra boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.game_uid,
         p.name,
         exists (select 1 from public.gift_claim_exclusions x
                  where x.alliance_id = (select public.active_alliance())
                    and x.game_uid = p.game_uid),
         coalesce((select jsonb_object_agg(c.code_id::text, c.status)
                     from public.gift_code_claims c
                    where c.alliance_id = (select public.active_alliance())
                      and c.game_uid = p.game_uid),
                  '{}'::jsonb),
         p.extra
    from (
      select r.game_uid, r.name, false as extra
        from public.alliance_roster_latest r
       where r.alliance_id = (select public.active_alliance())
      union all
      select e.game_uid, coalesce(e.label, 'UID ' || e.game_uid::text), true
        from public.gift_extra_players e
       where e.alliance_id = (select public.active_alliance())
         and not exists (
           select 1 from public.alliance_roster_latest r
            where r.alliance_id = e.alliance_id and r.game_uid = e.game_uid)
    ) p
   order by p.extra, p.name;
$$;

revoke all on function public.add_gift_extra_players(bigint[], text) from public, anon, authenticated;
revoke all on function public.remove_gift_extra_player(bigint) from public, anon, authenticated;
revoke all on function public.enqueue_gift_claims(uuid[], bigint[]) from public, anon, authenticated;
revoke all on function public.gift_code_progress() from public, anon, authenticated;
revoke all on function public.gift_member_status() from public, anon, authenticated;
grant execute on function public.add_gift_extra_players(bigint[], text) to authenticated, service_role;
grant execute on function public.remove_gift_extra_player(bigint) to authenticated, service_role;
grant execute on function public.enqueue_gift_claims(uuid[], bigint[]) to authenticated, service_role;
grant execute on function public.gift_code_progress() to authenticated, service_role;
grant execute on function public.gift_member_status() to authenticated, service_role;
