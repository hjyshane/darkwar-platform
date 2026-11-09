-- 0309: a cost may be a counter, vehicle chips are a kind, a season building
-- says which game season it is, and an EXP card says what it is worth.
--
-- The calculator reference mode (docs/superpowers/specs/2026-11-08-
-- calculator-reference-design.md) adds vehicle chips as a subject. A chip's
-- star-up takes EXP POINTS and DUPLICATES of the same chip, neither of which
-- is an item or a resource a player holds: EXP points come from cards (goods
-- type 224, 500 to 60,000 each) or from feeding lesser chips, and a duplicate
-- is another copy of the chip itself. So `costs` gains one more `type`:
--
--   [{"type": "counter", "id": "chip_exp", "amount": 500},
--    {"type": "counter", "id": "chip_duplicate:4", "amount": 1}]
--
-- with a text id. The planner's totals() sums counters by id like anything
-- else; its stock matching leaves them out (a player holds EXP cards, not
-- points). Until now `costs` was checked only for being an array; the new
-- check also reads each entry, so a type the dashboard does not know is
-- refused at the door instead of rendered as nothing.
--
-- Chips come from the client's `car_microchip_promote`: kind 'chip', subject
-- the quality (4 purple, 5 orange — green and blue do not upgrade), level the
-- star x 10 + sub-step reached, name the game's own "0★ 5/10".
--
-- Season buildings were already imported with the rest of `building` (0246
-- noticed), costs and time populated. The client's `building_season` column
-- says which GAME season theme each belongs to (4 is Smart Greenhouse …
-- Defensive Base, our Season 3; 6 is Mineral Factory … Guardian Gem). It is
-- the game's id, not seasons.season_id, hence `game_season` and no foreign key;
-- features/calculator/seasons.ts maps the two where we know both.
--
-- `game_items.counter_value` is what an item is worth in a counter when it is
-- used: {"id": "chip_exp", "amount": 60000} on the Big EXP card, so "129M EXP
-- = 2,152 × Big EXP card" is worked out from data, not a constant.

create function public.costs_are_valid(p_costs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_costs) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(p_costs) as c
        where jsonb_typeof(c) <> 'object'
           or coalesce(c->>'type', '') not in ('resource', 'item', 'counter')
           or coalesce(jsonb_typeof(c->'id'), '') <> 'string'
           or coalesce(jsonb_typeof(c->'amount'), '') <> 'number'
     );
$$;

-- Only the check constraint calls it, as whoever is inserting: the collector's
-- key. The hosted project hands anon EXECUTE on new functions by default
-- (0185), so take it back explicitly.
revoke all on function public.costs_are_valid(jsonb) from public, anon;
grant execute on function public.costs_are_valid(jsonb) to service_role;

comment on function public.costs_are_valid(jsonb) is
  'Every entry of a costs array is {type: resource|item|counter, id: text, amount: number} (0309).';

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_costs_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_costs_check check (public.costs_are_valid(costs));

alter table public.game_upgrade_steps drop constraint game_upgrade_steps_kind_check;
alter table public.game_upgrade_steps
  add constraint game_upgrade_steps_kind_check
  check (kind in (
    'building', 'research', 'vehicle_part', 'vehicle', 'pet', 'pet_break',
    'hero', 'hero_gear', 'exclusive', 'chip'
  ));

alter table public.game_upgrade_steps add column game_season int;

comment on column public.game_upgrade_steps.game_season is
  'The game''s season theme a season building belongs to (the client''s '
  'building_season: 4 Smart Greenhouse …, 6 Mineral Factory …). Null on anything '
  'that is not a season building. Not seasons.season_id (0309).';

alter table public.game_items add column counter_value jsonb
  check (
    counter_value is null
    or (jsonb_typeof(counter_value) = 'object'
        and jsonb_typeof(counter_value->'id') = 'string'
        and jsonb_typeof(counter_value->'amount') = 'number')
  );

comment on column public.game_items.counter_value is
  'What using the item is worth in a counter cost: {"id": "chip_exp", "amount": 60000} '
  'on a Chip Star-Up EXP Card. Null on every other item (0309).';

-- The per-subject summary (0222, 0224) gains the season, so the calculator's
-- season picker is one read of the view. Body as 0224 left it, one column added
-- at the end (create or replace allows exactly that).
create or replace view public.game_upgrade_subjects
with (security_invoker = true) as
with first_tier as (
  select kind, subject_id, min(level) as level
  from public.game_upgrade_steps
  where tier is not null
  group by kind, subject_id
)
select
  s.kind,
  s.subject_id,
  max(s.level) as max_level,
  min(s.category) as category,
  (array_agg(s.name order by s.level desc)
    filter (where s.name is not null and (f.level is null or s.level < f.level)))[1] as name,
  (array_agg(s.name_ko order by s.level desc)
    filter (where s.name_ko is not null and (f.level is null or s.level < f.level)))[1] as name_ko,
  min(s.game_season) as game_season
from public.game_upgrade_steps s
left join first_tier f on f.kind = s.kind and f.subject_id = s.subject_id
group by s.kind, s.subject_id;
