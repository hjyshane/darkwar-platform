-- 0013: battle_report_ingests — receive and keep reports, decode later.
--
-- §11.3 lists this table with the rest of the battle-report group, which was
-- deferred because the protocol was unconfirmed. The RECEIVING half is now
-- confirmed and this table covers only that: a battle report arrives as a
-- mail whose `custom` carries a `battleReportSimple` marker, and the body
-- holds `battleContent` — base64 protobuf.
--
-- The analysis tables (battle_reports, sides, heroes, troops) stay deferred.
-- Their columns would be guesses: no .proto ships in the APK and no
-- descriptor strings are in the code bundles, so field meanings are unknown.
-- Storing the body now means those months of reports exist to analyse once
-- the schema is worked out; not storing it means starting from zero then.
--
-- What is deliberately NOT interpreted:
--   * fromUser/fromName are EMPTY on the observed report mails — they are
--     system-generated battle results, not player-to-player messages.
--   * toUser is the mail's recipient, which for a battle result is presumably
--     the player who fought. "Presumably" is why it is stored as an uid and
--     not resolved to a player row: sharing propagates a mail, and which
--     party the reader is has not been verified.

create table public.battle_report_ingests (
  ingest_id uuid primary key default gen_random_uuid(),
  observation_id uuid not null,
  source_command text not null,
  parser_version text not null,
  idempotency_key text not null unique,
  captured_at timestamptz not null,
  collector_id uuid not null references public.collectors (collector_id),
  collected_from_server_id int not null references public.servers (server_id),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  mail_uid text not null,
  mail_type int,
  -- Both nullable and both unresolved on purpose (see above).
  from_game_uid bigint,
  to_game_uid bigint,
  sent_at timestamptz,
  expires_at timestamptz,
  -- Base64 protobuf, exactly as it arrived. Undecoded.
  report_content text,
  -- The `custom` marker block that identified this as a report.
  report_marker jsonb
);

create index battle_report_ingests_captured_idx
  on public.battle_report_ingests (captured_at desc);
create index battle_report_ingests_to_uid_idx
  on public.battle_report_ingests (to_game_uid, captured_at desc)
  where to_game_uid is not null;

alter table public.battle_report_ingests enable row level security;

grant select on public.battle_report_ingests to anon, authenticated;
grant all on public.battle_report_ingests to service_role;

-- Admin only. §17.3 puts raw payload at "Admin 제한 R", and a battle report
-- exposes another player's army composition. FR-BR-008 consent and
-- report_data_consents must exist before anyone wider can read this.
create policy admin_read on public.battle_report_ingests
  for select to authenticated
  using (public.current_app_role() = 'admin');

-- No notify trigger. notify_data_change() scopes a notification by
-- `server_id`, and this table deliberately has none: a report's subject
-- server is whatever the undecoded body says, and `collected_from_server_id`
-- is provenance, not subject. Nothing in the UI reads these rows yet anyway.
-- When a decoder exists and reports get a subject, add the column and the
-- trigger together.
