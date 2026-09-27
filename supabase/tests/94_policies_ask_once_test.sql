-- 0179: no policy in public calls a row-independent gate function bare, and a
-- member's read plans the gate once rather than per row.
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- The regex 0179 applied, made tolerant of a deparse with or without the
-- schema prefix (pg_policies deparses under the session's search_path).
create function pg_temp.bare_gate(expr text)
returns boolean language sql immutable as $$
  select coalesce(expr ~ ('(?<!SELECT )((public\.)?(current_app_role|linked_player_id|is_service_request)\(\)'
                          || '|(public\.)?has_permission\(''[^'']*''::text\))'), false)
$$;

select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and (pg_temp.bare_gate(qual) or pg_temp.bare_gate(with_check)) $$,
  'no public policy calls a gate function per row');

-- The check above passes vacuously if it cannot see the calls at all.
select cmp_ok(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and qual ~ 'SELECT (public\.)?current_app_role\(\)'),
  '>', 20,
  'the wrapped calls are visible to the check — it is not passing vacuously');

select ok(
  exists (select 1 from pg_policies
           where schemaname = 'public'
             and coalesce(qual, '') || coalesce(with_check, '') ~ 'SELECT (public\.)?has_permission\('),
  'permission gates are wrapped too');

-- The point of the change, pinned on a plan: as a signed-in member the gate is
-- an InitPlan, computed once for the statement.
create function pg_temp.plan_of(q text)
returns text language plpgsql as $$
declare
  line text;
  result text := '';
begin
  for line in execute 'explain ' || q loop
    result := result || line || E'\n';
  end loop;
  return result;
end
$$;

set local role authenticated;
select ok(
  pg_temp.plan_of('select snapshot_id from public.black_money_score_snapshots') ~ 'InitPlan',
  'a member read of a member-only table plans the role gate as an InitPlan');
reset role;

-- And the gate still gates: a signed-in request with no member role reads
-- nothing, exactly as before.
set local role authenticated;
select is_empty($$ select snapshot_id from public.alliance_season_score_snapshots $$,
  'a request with no member role still reads nothing');
reset role;

select * from finish();
rollback;
