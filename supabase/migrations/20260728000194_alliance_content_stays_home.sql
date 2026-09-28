-- 0194: what an alliance writes, only that alliance reads.
--
-- Phase 3a of docs/superpowers/plans/2026-09-28-multi-alliance.md. Notices,
-- guides and their comments/reads/views, the schedule, hive formations and
-- templates, join codes and player claims become visible and writable only
-- inside the alliance being viewed (0193's active_alliance()). With one
-- pinned alliance that is every row, so nothing changes in production yet.
--
-- HOW: RESTRICTIVE POLICIES. A restrictive policy is ANDed with whatever the
-- permissive ones already say, so the ~50 existing policies on these tables
-- (member_read, writer_insert, planner_update, ...) keep their exact text and
-- meaning, and this adds one clause beside each: "and it is this alliance's".
-- The alternative — rewriting every policy — is fifty chances to drop a
-- clause 0045 or 0179 put there on purpose.
--
-- NULL alliance_id MEANS PRIMARY. Rows written before anything was pinned
-- (a fresh install, most pgTAP fixtures) have no alliance. Treating them as
-- the primary's keeps them where they always were instead of hiding them the
-- moment somebody pins an alliance.
--
-- Both functions are wrapped in (SELECT ...) so they run once per statement,
-- not per row — 0179's lesson, which cost a timeout to learn.
--
-- DEFINER RPCS BYPASS ALL OF THAT. save_hive_formation_layout,
-- assign_hive_formation_slots, save_hive_formation_template and
-- record_post_view run as their owner, so RLS never sees them. Guard
-- triggers close that door: a write made in a signed-in user's request, to a
-- row outside the alliance they are viewing, is refused. The guard keys on
-- auth.uid() rather than is_service_request(), because inside a definer
-- function current_user IS the owner and is_service_request() would always
-- say yes. Service keys carry no `sub`, so the collector and dw-notify pass.

-- ---------------------------------------------------------------------------
-- New rows land in the alliance being viewed, not always the primary.

alter table public.join_codes alter column alliance_id set default public.active_alliance();
alter table public.player_claims alter column alliance_id set default public.active_alliance();
alter table public.announcements alter column alliance_id set default public.active_alliance();
alter table public.guides alter column alliance_id set default public.active_alliance();
alter table public.schedule_categories alter column alliance_id set default public.active_alliance();
alter table public.schedule_events alter column alliance_id set default public.active_alliance();
alter table public.hive_formations alter column alliance_id set default public.active_alliance();
alter table public.hive_formation_templates alter column alliance_id set default public.active_alliance();

-- ---------------------------------------------------------------------------
-- Tables that carry alliance_id.

create policy alliance_scope on public.announcements as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.guides as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.schedule_categories as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.schedule_events as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.hive_formations as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.hive_formation_templates as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

-- Admin-only today (0021), and an admin sees every alliance by switching: the
-- codes listed are the codes for the alliance on screen.
create policy alliance_scope on public.join_codes as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

create policy alliance_scope on public.player_claims as restrictive
  for all to authenticated
  using (coalesce(alliance_id, (select public.primary_own_alliance()))
         is not distinct from (select public.active_alliance()))
  with check (coalesce(alliance_id, (select public.primary_own_alliance()))
              is not distinct from (select public.active_alliance()));

-- ---------------------------------------------------------------------------
-- Children reach through their parent. The subqueries run under the
-- parent's RLS, restrictive policy included, so "the parent is visible to
-- me" already means "the parent is this alliance's".

create policy alliance_scope on public.post_comments as restrictive
  for all to authenticated
  using (exists (select 1 from public.guides g where g.guide_id = post_comments.guide_id)
         or exists (select 1 from public.announcements a
                     where a.announcement_id = post_comments.announcement_id))
  with check (exists (select 1 from public.guides g where g.guide_id = post_comments.guide_id)
              or exists (select 1 from public.announcements a
                          where a.announcement_id = post_comments.announcement_id));

create policy alliance_scope on public.post_reads as restrictive
  for all to authenticated
  using (exists (select 1 from public.guides g where g.guide_id = post_reads.guide_id)
         or exists (select 1 from public.announcements a
                     where a.announcement_id = post_reads.announcement_id))
  with check (exists (select 1 from public.guides g where g.guide_id = post_reads.guide_id)
              or exists (select 1 from public.announcements a
                          where a.announcement_id = post_reads.announcement_id));

create policy alliance_scope on public.post_views as restrictive
  for all to authenticated
  using (exists (select 1 from public.guides g where g.guide_id = post_views.guide_id)
         or exists (select 1 from public.announcements a
                     where a.announcement_id = post_views.announcement_id))
  with check (exists (select 1 from public.guides g where g.guide_id = post_views.guide_id)
              or exists (select 1 from public.announcements a
                          where a.announcement_id = post_views.announcement_id));

create policy alliance_scope on public.schedule_reminders as restrictive
  for all to authenticated
  using (exists (select 1 from public.schedule_events e
                  where e.schedule_event_id = schedule_reminders.schedule_event_id))
  with check (exists (select 1 from public.schedule_events e
                       where e.schedule_event_id = schedule_reminders.schedule_event_id));

create policy alliance_scope on public.hive_formation_slots as restrictive
  for all to authenticated
  using (exists (select 1 from public.hive_formations f
                  where f.formation_id = hive_formation_slots.formation_id))
  with check (exists (select 1 from public.hive_formations f
                       where f.formation_id = hive_formation_slots.formation_id));

create policy alliance_scope on public.hive_formation_template_slots as restrictive
  for all to authenticated
  using (exists (select 1 from public.hive_formation_templates t
                  where t.template_id = hive_formation_template_slots.template_id))
  with check (exists (select 1 from public.hive_formation_templates t
                       where t.template_id = hive_formation_template_slots.template_id));

-- ---------------------------------------------------------------------------
-- Uniqueness that meant "per install" now means "per alliance". NULLS NOT
-- DISTINCT so an unpinned install still gets the old guarantee.

drop index public.hive_formation_one_active_per_server;
create unique index hive_formation_one_active_per_server
  on public.hive_formations (alliance_id, server_id) nulls not distinct
  where is_active;

drop index public.hive_formation_templates_one_per_name;
create unique index hive_formation_templates_one_per_name
  on public.hive_formation_templates (alliance_id, lower(btrim(name))) nulls not distinct;

-- ---------------------------------------------------------------------------
-- The definer door.

create function public.refuse_other_alliance(p_alliance uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- No user behind the request: the collector, dw-notify, cron, a migration.
  if (select auth.uid()) is null then
    return;
  end if;
  if coalesce(p_alliance, public.primary_own_alliance())
     is distinct from public.active_alliance() then
    raise exception 'that belongs to another alliance' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.refuse_other_alliance(uuid) from public, anon, authenticated;

comment on function public.refuse_other_alliance(uuid) is
  'Raise 42501 when a signed-in request touches a row of an alliance it is '
  'not viewing. For guard triggers under SECURITY DEFINER functions, which '
  'RLS never sees. A no-op without auth.uid() (service key, cron).';

create function public.guard_alliance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refuse_other_alliance(old.alliance_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refuse_other_alliance(new.alliance_id);
    return new;
  end if;
  return old;
end;
$$;

-- A slot whose parent cannot be found is being removed BY that parent's
-- delete (on delete cascade runs after the parent row is gone). The parent's
-- own guard already ruled on it; falling back to "primary" here would refuse
-- every formation delete in any other alliance.
create function public.guard_hive_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select f.alliance_id into v_alliance
    from public.hive_formations f where f.formation_id = old.formation_id;
    if found then
      perform public.refuse_other_alliance(v_alliance);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select f.alliance_id into v_alliance
    from public.hive_formations f where f.formation_id = new.formation_id;
    if found then
      perform public.refuse_other_alliance(v_alliance);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create function public.guard_hive_template_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alliance uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select t.alliance_id into v_alliance
    from public.hive_formation_templates t where t.template_id = old.template_id;
    if found then
      perform public.refuse_other_alliance(v_alliance);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select t.alliance_id into v_alliance
    from public.hive_formation_templates t where t.template_id = new.template_id;
    if found then
      perform public.refuse_other_alliance(v_alliance);
    end if;
    return new;
  end if;
  return old;
end;
$$;

create function public.guard_post_view()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refuse_other_alliance(coalesce(
    (select g.alliance_id from public.guides g where g.guide_id = new.guide_id),
    (select a.alliance_id from public.announcements a
      where a.announcement_id = new.announcement_id)));
  return new;
end;
$$;

revoke all on function public.guard_alliance_row() from public, anon, authenticated;
revoke all on function public.guard_hive_slot() from public, anon, authenticated;
revoke all on function public.guard_hive_template_slot() from public, anon, authenticated;
revoke all on function public.guard_post_view() from public, anon, authenticated;

create trigger guard_alliance
  before insert or update or delete on public.hive_formations
  for each row execute function public.guard_alliance_row();
create trigger guard_alliance
  before insert or update or delete on public.hive_formation_templates
  for each row execute function public.guard_alliance_row();
create trigger guard_alliance
  before insert or update or delete on public.hive_formation_slots
  for each row execute function public.guard_hive_slot();
create trigger guard_alliance
  before insert or update or delete on public.hive_formation_template_slots
  for each row execute function public.guard_hive_template_slot();
-- record_post_view upserts; the insert path and the update path both land here.
create trigger guard_alliance
  before insert or update on public.post_views
  for each row execute function public.guard_post_view();
