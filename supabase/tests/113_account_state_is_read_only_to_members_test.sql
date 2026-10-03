-- 0207: authenticated holds select and nothing else on account state —
-- whatever default privileges the hosted project hands out. TRUNCATE in
-- particular, which RLS does not stop.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(has_table_privilege('authenticated', 'public.account_state_snapshots', 'select'),
  'authenticated reads account state (subject to the owner-or-admin policy)');
select ok(not has_table_privilege('authenticated', 'public.account_state_snapshots',
                                  'insert, update, delete, truncate'),
  'authenticated cannot write or truncate account_state_snapshots');
select ok(not has_table_privilege('authenticated', 'public.account_state_latest',
                                  'insert, update, delete, truncate'),
  'authenticated cannot write or truncate account_state_latest');
select ok(has_table_privilege('service_role', 'public.account_state_snapshots', 'insert'),
  'the collector still writes it');

select * from finish();
rollback;
