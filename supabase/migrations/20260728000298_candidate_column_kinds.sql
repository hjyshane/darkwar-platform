-- 0298: a candidate column has a kind, and a dropdown has its list.
--
-- 0293 made every extra column free text. Officers asked to choose: a number (so it
-- sorts as one), text, a note (longer, several lines), or a dropdown whose choices they
-- set. The cells stay strings in `migration_candidates.extra`; the kind decides how the
-- page draws, validates and sorts them, so nothing already written changes meaning.
--
-- `options` holds the dropdown's choices, in order, and is empty for every other kind.
-- A dropdown with no choices is refused: it could not be used.

alter table public.migration_candidate_columns
  add column kind text not null default 'text'
    check (kind in ('text', 'number', 'dropdown', 'note')),
  add column options jsonb not null default '[]'::jsonb;

alter table public.migration_candidate_columns
  add constraint migration_candidate_columns_options_check check (
    jsonb_typeof(options) = 'array'
    and not jsonb_path_exists(options, '$[*] ? (@.type() != "string")')
    and not jsonb_path_exists(options, '$[*] ? (@ == "")')
    and (kind = 'dropdown') = (jsonb_array_length(options) > 0)
  );

update public.migration_candidate_columns set kind = 'note' where label = 'Notes';

comment on column public.migration_candidate_columns.kind is
  'How the column is drawn and sorted: text, number, note (long text) or dropdown (0298).';
comment on column public.migration_candidate_columns.options is
  'The choices of a dropdown column, in order; empty for any other kind (0298).';
