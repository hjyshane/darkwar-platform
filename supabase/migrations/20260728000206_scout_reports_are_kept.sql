-- Scout results join the battle reports in battle_report_ingests, undecoded.
--
-- Report mails carry their body as base64 protobuf under `scoutContent`
-- (scout results, mail type 8) or `battleContent` (battle reports). The
-- collector now keeps every one that reaches the inbox or is pushed, not
-- only the ones somebody shared (normalize/report_mail.py). A battle body is
-- the same `mail_simple` kind mail.read.share has always written; a scout
-- body is new, so the kind check learns it.
--
-- Read access is unchanged: admins only (0013). The bodies name other
-- players' troops, heroes and resources.

alter table public.battle_report_ingests
  drop constraint battle_report_ingests_report_kind_check;

alter table public.battle_report_ingests
  add constraint battle_report_ingests_report_kind_check
    check (report_kind in ('mail_simple', 'detail', 'scout'));

comment on column public.battle_report_ingests.report_kind is
  'mail_simple = the battleContent body of a battle report mail; '
  'detail = the fuller body returned when the report is opened; '
  'scout = the scoutContent body of a scout result mail.';
