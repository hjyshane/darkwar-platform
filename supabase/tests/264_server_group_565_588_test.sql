-- 0264: all 24 servers are the tracked group 565-588.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select is((select count(*) from public.servers where server_id between 565 and 588), 24::bigint,
  'every server 565-588 exists, including ones a fresh database never saw');
select is((select count(*) from public.servers
           where server_id between 565 and 588
             and server_group = '565-588' and is_tracked), 24::bigint,
  'and each is in group 565-588 and tracked');
select is((select count(*) from public.servers where server_group = '577-584'), 0::bigint,
  'the old group label is gone');

-- Re-running changes nothing, and a merged server keeps its flags.
update public.servers set merged_into_server_id = 580, server_group = 'merged', is_tracked = false
where server_id = 570;
insert into public.servers (server_id, server_group, is_tracked)
select s, '565-588', true from generate_series(565, 588) as s
on conflict (server_id) do update
  set server_group = excluded.server_group, is_tracked = excluded.is_tracked
  where public.servers.merged_into_server_id is null;
select is((select server_group from public.servers where server_id = 570), 'merged',
  'the upsert shape leaves a merged server alone');

select * from finish();
rollback;
