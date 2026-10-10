-- 0271: the Gift Center's "token expired" (10006) answers every request, not one
-- player's, so it stops the sender instead of spending each claim's attempts.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select is(
  (select kind from internal.gift_classify(200, '{"code":10006,"message":"system fail"}', false, null)),
  'stop', '10006 stops the sender');
select is(
  (select error from internal.gift_classify(200, '{"code":10006,"message":"system fail"}', false, null)),
  '10006: system fail', 'and says why');
select is(
  (select kind from internal.gift_classify(200, '{"code":10018,"message":"params error"}', false, null)),
  'retry', 'a wrong player ID is still only that player''s problem');
select is(
  (select kind from internal.gift_classify(200, '{"errorCode":"E004","message":"x"}', false, null)),
  'invalid', 'and a code that does not exist is still a dead code');

select * from finish();
rollback;
