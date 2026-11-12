-- 0322: llm_drafts and llm_digest_facts - the plumbing for model-written drafts.
--
-- docs/superpowers/specs/2026-11-12-llm-features-design.md. A model may write ABOUT the
-- numbers; it never produces or decides them. So this migration adds two things and
-- nothing that touches scoring, ingest or the roster:
--
--   llm_digest_facts(period)  one bounded jsonb of facts, read through the CALLER's
--                             RLS (security invoker), officer/admin only. This is the
--                             only thing a model is ever shown.
--   llm_drafts                what a model wrote, with its facts, model id and prompt
--                             version beside it. A draft is text for a human to edit and
--                             approve; nothing reads it back into a state change.
--
-- WHY invoker AND NOT definer. The Edge Function forwards the officer's JWT (and the
-- x-alliance-id header), so rank_period_latest's own policies - member_read and the
-- restrictive alliance_scope (0196) - decide which period rows exist for this caller.
-- The facts can never name another alliance's members, because the caller cannot see
-- them. A definer function would have to re-implement that scoping, and one forgotten
-- filter would leak it.
--
-- ONE ROW PER PERSON, BOUNDED. Lists are capped (20/30) and say so (`truncated`), so
-- PostgREST's 1,000-row cap is never in play and the prompt has a known size.
--
-- WHAT IT DOES NOT DO. No daily cap and no kill switch live here: the function reads
-- them from app_settings key 'llm_digest' ({"enabled": bool, "daily_cap": int}); absent
-- means disabled. Seeded disabled below, so merging this changes nothing until an admin
-- turns it on.

-- ---------------------------------------------------------------------------
-- The table.

create table public.llm_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  alliance_id uuid not null references public.alliances (alliance_id) on delete cascade
    default public.active_alliance(),
  kind text not null check (kind in ('weekly_digest')),
  period_start timestamptz,
  -- The exact facts the model was shown, and their hash: a draft is checkable against
  -- its own input, and "same facts, new prompt" is visible without re-reading jsonb.
  facts jsonb not null,
  facts_hash text not null,
  prompt_version text not null,
  model text not null,
  output text not null check (length(output) <= 8000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'discarded')),
  -- The officer's edited text. `output` is never rewritten.
  final_text text check (final_text is null or length(final_text) <= 8000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);

comment on table public.llm_drafts is
  'Text a model drafted from llm_digest_facts, for an officer to edit and approve (0322). '
  'Insert-only for the model path: output, facts, model and prompt_version are never '
  'updated; an officer sets status and final_text once. Nothing reads a draft back into '
  'any state.';

create index llm_drafts_alliance_idx on public.llm_drafts (alliance_id, created_at desc);

alter table public.llm_drafts enable row level security;
-- Hosted projects hand new tables to authenticated with every privilege (0185). Column
-- grants are the narrowing: status cannot be set on insert, and only status/final_text
-- can ever be updated.
revoke all on public.llm_drafts from public, anon, authenticated;
grant select on public.llm_drafts to authenticated;
grant insert (kind, period_start, facts, facts_hash, prompt_version, model, output)
  on public.llm_drafts to authenticated;
grant update (status, final_text) on public.llm_drafts to authenticated;
grant all on public.llm_drafts to service_role;

create policy officer_read on public.llm_drafts
  for select to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'));

create policy officer_insert on public.llm_drafts
  for insert to authenticated
  with check (
    (select public.current_app_role()) in ('officer', 'admin')
    and created_by = (select auth.uid())
  );

create policy officer_update on public.llm_drafts
  for update to authenticated
  using ((select public.current_app_role()) in ('officer', 'admin'))
  with check ((select public.current_app_role()) in ('officer', 'admin'));

-- The alliance being viewed, and no other (0196's shape).
create policy alliance_scope on public.llm_drafts as restrictive
  for all to authenticated
  using (alliance_id is not distinct from (select public.active_alliance()))
  with check (alliance_id is not distinct from (select public.active_alliance()));

-- A draft is decided once. Stamps who and when; refuses a second decision.
create function public.llm_drafts_decide()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'llm_drafts: draft % is already %', old.draft_id, old.status
      using errcode = '23514';
  end if;
  if new.status <> 'draft' then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger llm_drafts_decide
  before update on public.llm_drafts
  for each row execute function public.llm_drafts_decide();

-- ---------------------------------------------------------------------------
-- The facts.

create function public.llm_digest_facts(p_period_start timestamptz default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_period timestamptz;
  v_prev timestamptz;
  v_result jsonb;
begin
  if (select public.current_app_role()) not in ('officer', 'admin') then
    raise exception 'officers only' using errcode = '42501';
  end if;

  v_period := coalesce(p_period_start, (select max(s.period_start) from public.rank_period_latest s));
  if v_period is null then
    return jsonb_build_object('facts_version', 1, 'period_start', null, 'member_count', 0);
  end if;
  v_prev := (select max(s.period_start) from public.rank_period_latest s where s.period_start < v_period);

  with cur as (
    select * from public.rank_period_latest where period_start = v_period
  ),
  prev as (
    select player_id, tier from public.rank_period_latest where period_start = v_prev
  ),
  changed as (
    select c.name, p.tier as from_tier, c.tier as to_tier, c.tier_reason
    from cur c
    join prev p using (player_id)
    where p.tier is distinct from c.tier
  ),
  moved as (
    select c.name, m.from_server_id, m.to_server_id, m.seen_at
    from cur c
    join public.player_server_moves m on m.player_id = c.player_id
    where m.seen_at >= v_period
      and m.seen_at < coalesce((select max(period_end) from cur), v_period + interval '14 days')
  )
  select jsonb_build_object(
    'facts_version', 1,
    'period_start', v_period,
    'period_end', (select max(period_end) from cur),
    'previous_period_start', v_prev,
    'member_count', (select count(*) from cur),
    'tiers', coalesce((select jsonb_object_agg(t, n)
                       from (select coalesce(tier, 'none') as t, count(*) as n from cur group by 1) x), '{}'::jsonb),
    'offline_demotions', (select count(*) from cur where tier_reason = 'offline'),
    'tier_changes', jsonb_build_object(
      'count', (select count(*) from changed),
      'truncated', (select count(*) > 30 from changed),
      'items', coalesce((select jsonb_agg(to_jsonb(x)) from
        (select * from changed order by name limit 30) x), '[]'::jsonb)
    ),
    'top_power_growth', coalesce((select jsonb_agg(to_jsonb(x)) from
      (select name, power_growth from cur where power_growth is not null
       order by power_growth desc, name limit 5) x), '[]'::jsonb),
    'server_moves', jsonb_build_object(
      'count', (select count(*) from moved),
      'truncated', (select count(*) > 20 from moved),
      'items', coalesce((select jsonb_agg(to_jsonb(x)) from
        (select * from moved order by seen_at limit 20) x), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.llm_digest_facts(timestamptz) from public, anon;
grant execute on function public.llm_digest_facts(timestamptz) to authenticated, service_role;

comment on function public.llm_digest_facts(timestamptz) is
  'The only input a model is shown for the weekly digest (0322): tiers, tier changes, '
  'top power growth and server moves of one rank period, read through the caller''s RLS. '
  'Officers and admins only. Lists are capped and flagged `truncated`.';

-- ---------------------------------------------------------------------------
-- Off until an admin turns it on. app_settings is the primary's row; 0200 covers others.

insert into public.app_settings (key, value)
values ('llm_digest', '{"enabled": false, "daily_cap": 5}'::jsonb)
on conflict (key) do nothing;
