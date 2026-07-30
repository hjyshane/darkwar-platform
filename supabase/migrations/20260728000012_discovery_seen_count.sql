-- 0012: make schema_observations.seen_count mean what it says.
--
-- The column existed with a default of 1 and never moved: sync upserts with
-- resolution=ignore-duplicates, so a shape seen a hundred times still read
-- "1". A column that lies is worse than no column, and the count is the
-- signal that tells an admin whether an unknown command is a one-off or
-- constant traffic.
--
-- Handled in the database rather than the collector because only the
-- database knows the row already existed. Sync now merges duplicates for
-- this table, which turns the conflict into an UPDATE that this trigger
-- observes.

create function public.bump_schema_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A sighting is an update that advances last_seen_at; anything else is an
  -- operator editing the row. Distinguishing them matters both ways: without
  -- it, marking a command 'mapped' would inflate the count, and the sync
  -- payload's default review_status would undo the decision.
  if new.last_seen_at > old.last_seen_at then
    new.seen_count := old.seen_count + 1;
    new.first_seen_at := least(old.first_seen_at, new.first_seen_at);
    new.review_status := old.review_status;
  else
    new.seen_count := old.seen_count;
    new.first_seen_at := old.first_seen_at;
    new.last_seen_at := old.last_seen_at;
  end if;
  return new;
end;
$$;

create trigger schema_observations_bump
  before update on public.schema_observations
  for each row execute function public.bump_schema_observation();
