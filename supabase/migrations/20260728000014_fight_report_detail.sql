-- 0014: the opened report, alongside the received one.
--
-- `get.fight.report.detail` returns a report body too, and measurably not
-- the same body: on the 2026-07-30 walkthrough the mail carried 5,642
-- decoded bytes and the detail 12,340, with different leading protobuf
-- fields and no containment either way. The mail's marker calls its copy
-- `battleReportSimple`, which fits — one is a summary, one is the full
-- thing.
--
-- Both go in battle_report_ingests rather than a second table: a future
-- decoder wants every report body in one place, and the only real
-- difference is which fields around it exist.
--
-- A detail response carries no mail: no uid, no sender, no recipient, no
-- timestamps. Only the body. So mail_uid stops being required, and
-- report_kind says which shape a row is rather than leaving that to be
-- inferred from which columns are null.

alter table public.battle_report_ingests
  alter column mail_uid drop not null;

alter table public.battle_report_ingests
  add column report_kind text not null default 'mail_simple'
    check (report_kind in ('mail_simple', 'detail'));

-- The default exists to backfill rows written before this column; new rows
-- must say what they are.
alter table public.battle_report_ingests
  alter column report_kind drop default;

comment on column public.battle_report_ingests.report_kind is
  'mail_simple = the battleReportSimple body from a report mail; '
  'detail = the fuller body returned when the report is opened.';

create index battle_report_ingests_kind_idx
  on public.battle_report_ingests (report_kind, captured_at desc);
