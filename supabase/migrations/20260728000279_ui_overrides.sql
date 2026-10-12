-- 0279: names, order and visibility an admin sets from the page itself.
--
-- Asked for on 2026-10-11: rename a page, reorder its tabs, hide an entry --
-- from the page, in an edit mode, not from a settings screen. One table holds
-- every such choice:
--
--   scope  which screen or group of entries   ('events-hub')
--   key    the thing on it                    ('blackMoney')
--   kind   what is overridden                 ('label' | 'order' | 'hidden')
--   value  the new text, a position, or 'true'
--
-- DISPLAY ONLY. An override changes what is drawn, never an address, a data
-- key or a sort key, so renaming "Participation" cannot break a link or a
-- report. Nothing stored means the code's default shows; deleting a row puts
-- the default back.
--
-- One name for everybody and no translations: the app is English-only.
--
-- Everyone signed in reads it (the sidebar needs it on every screen); only an
-- admin writes, and only through the two functions below, which check the role
-- and the shape of the value. A direct insert could do neither.

create table public.ui_overrides (
  scope text not null check (scope ~ '^[a-z][a-z0-9_-]{0,39}$'),
  key text not null check (key ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  kind text not null check (kind in ('label', 'order', 'hidden')),
  value text not null check (length(value) between 1 and 60),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (scope, key, kind),
  -- A name is plain text: no markup, no control characters.
  constraint ui_overrides_label_is_plain
    check (kind <> 'label' or (value !~ '[<>]' and value !~ '[[:cntrl:]]' and btrim(value) <> '')),
  constraint ui_overrides_order_is_a_position
    check (kind <> 'order' or value ~ '^[0-9]{1,4}$'),
  constraint ui_overrides_hidden_is_true
    check (kind <> 'hidden' or value = 'true')
);

comment on table public.ui_overrides is
  'Names, order and visibility an admin sets from the page (0279). Display '
  'only; no row means the code''s default. Written only through '
  'set_ui_override / clear_ui_override.';

alter table public.ui_overrides enable row level security;
-- revoke-then-grant: hosted default privileges give authenticated all (0207).
revoke all on public.ui_overrides from anon, authenticated;
grant select on public.ui_overrides to authenticated;
grant all on public.ui_overrides to service_role;

create policy member_read on public.ui_overrides
  for select to authenticated
  using ((select public.current_app_role()) in ('member', 'officer', 'admin'));

-- ---------------------------------------------------------------------------

create function public.set_ui_override(p_scope text, p_key text, p_kind text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_app_role()) is distinct from 'admin' then
    raise exception 'only an admin may change what the pages are called'
      using errcode = '42501';
  end if;
  insert into public.ui_overrides (scope, key, kind, value, updated_by, updated_at)
  values (p_scope, p_key, p_kind, btrim(p_value), auth.uid(), now())
  on conflict (scope, key, kind) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

comment on function public.set_ui_override(text, text, text, text) is
  'Set one name, position or hidden flag (0279). Admin only; the table''s '
  'checks refuse markup, a non-numeric position and anything but hidden = true.';

-- Clear one kind, or every kind of one key when p_kind is null.
create function public.clear_ui_override(p_scope text, p_key text, p_kind text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int;
begin
  if (select public.current_app_role()) is distinct from 'admin' then
    raise exception 'only an admin may change what the pages are called'
      using errcode = '42501';
  end if;
  delete from public.ui_overrides
   where scope = p_scope and key = p_key and (p_kind is null or kind = p_kind);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

comment on function public.clear_ui_override(text, text, text) is
  'Put the default back for one key (0279): one kind, or all of them. Admin only.';

revoke all on function public.set_ui_override(text, text, text, text) from public, anon;
revoke all on function public.clear_ui_override(text, text, text) from public, anon;
grant execute on function public.set_ui_override(text, text, text, text) to authenticated;
grant execute on function public.clear_ui_override(text, text, text) to authenticated;
