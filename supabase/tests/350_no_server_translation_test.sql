-- 0350: the server-side translation cache from 0349 is gone.
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select hasnt_table('public', 'content_translations',
  'translation happens in the reader''s browser: no cache table is left (0350)');

select * from finish();
rollback;
