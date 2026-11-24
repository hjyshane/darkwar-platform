-- 0348: the ruby's dollar value is the setting site.ruby_dollar_rate, read by
-- shop_pack_value; anything unreadable is $0.0099.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into public.collectors (collector_id, name)
values ('00000000-0000-4000-8000-0000000ee348', 'ruby-rate-test');

-- A $4.99 pack of 1,500 rubies and nothing else: 1,500 x 0.0099 = $14.85.
insert into public.shop_pack_snapshots
  (observation_id, source_command, parser_version, idempotency_key, captured_at,
   collector_id, collected_from_server_id, server_id, pack_id, name_key, dollars, rubies,
   claimed_percent, items)
values
  (gen_random_uuid(), 'exchange.info', '1.0.0', 'rate:p348', now() - interval '1 day',
   '00000000-0000-4000-8000-0000000ee348', 580, 580, 'p348', '900348', 4.99, 1500, 1000, '[]');

delete from public.app_settings where key = 'site.ruby_dollar_rate';

-- 1-2. Nothing set: the old rate.
select is(public.ruby_dollar_rate(), 0.0099::numeric, 'with nothing set a ruby is $0.0099');
select is((select value_dollars from public.shop_pack_value where pack_id = 'p348'), 14.85,
  'the pack is valued at the old rate');

-- 3-5. An admin's rate reaches the value and the ratio together.
insert into public.app_settings (key, value) values ('site.ruby_dollar_rate', '0.01');
select is(public.ruby_dollar_rate(), 0.01::numeric, 'a stored rate is the rate');
select is((select value_dollars from public.shop_pack_value where pack_id = 'p348'), 15.00,
  'the $ value follows the stored rate');
select is((select value_ratio from public.shop_pack_value where pack_id = 'p348'), 3.01,
  'and so does the ratio beside it');

-- 6-8. Anything unreadable is the old rate, never zero or an error.
update public.app_settings set value = '"0.02"' where key = 'site.ruby_dollar_rate';
select is(public.ruby_dollar_rate(), 0.0099::numeric, 'a rate stored as text is ignored');
update public.app_settings set value = '5' where key = 'site.ruby_dollar_rate';
select is(public.ruby_dollar_rate(), 0.0099::numeric, 'a rate above $1 is ignored');
update public.app_settings set value = '0' where key = 'site.ruby_dollar_rate';
select is(public.ruby_dollar_rate(), 0.0099::numeric, 'a zero rate is ignored');

select * from finish();
rollback;
