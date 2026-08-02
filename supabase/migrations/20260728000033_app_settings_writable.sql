-- 0033: an admin can actually write app_settings, and the audit column says
-- who did.
--
-- 0032 gave the table an admin_write POLICY and granted only SELECT. A
-- policy decides which rows a role may touch; it cannot hand out a privilege
-- the role was never given, so every write was refused with 42501 before RLS
-- was consulted at all — including an admin's.
--
-- The tests did not catch it because they only asked the negative question.
-- 20_app_settings_test proved anon cannot write and stopped there, so a
-- table nobody could write passed a suite about who may write it. The
-- positive case is added below.

grant insert, update, delete on public.app_settings to authenticated;

-- With the privilege granted to the shared `authenticated` role, admin_write
-- is now the only thing standing between a member and the settings — which
-- is the arrangement 0016 and 0020 both described: app roles share one
-- database role, so RLS is where the distinction has to live.

-- The audit column, filled from the session rather than the request body.
-- The obvious alternative is for the admin screen to send its own user id,
-- which makes the audit field a claim by the party being audited — and the
-- one question the column exists to answer is exactly that one. auth.uid()
-- is not reachable from the client.
create function public.app_settings_set_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

comment on function public.app_settings_set_actor is
  'Stamp app_settings.updated_by from the session. The client never supplies '
  'it — an audit field the audited party can write is not an audit field.';

create trigger app_settings_actor
  before insert or update on public.app_settings
  for each row execute function public.app_settings_set_actor();
