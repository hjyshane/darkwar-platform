-- 0093: a decided claim reaches the member who filed it.
--
-- 0068 made claiming a character a two-step: the member says who they are, an
-- officer approves, and `app_users.player_id` moves only inside
-- approve_player_claim(). That rule stands. What it lacked was any way for the
-- answer to arrive.
--
-- The member's page reads `player_claims` once on mount and caches it. An
-- officer approving a claim wrote two tables the member was watching neither
-- of, so the screen went on saying "waiting for an officer to confirm it"
-- until a reload — and a member who has just been told to reload is a member
-- who reloads twice more to check.
--
-- Neither table is in the realtime publication and neither should be:
-- FR-UI-005 has the UI listen to `data_change_notifications` and nothing else,
-- so a table's rows never travel over the socket. A topic is a string. What
-- goes out here is "something about claims changed", which is not a fact about
-- anybody in particular.
--
-- Statement-level, like every other notify trigger: one message per statement,
-- not one per row. approve_player_claim() touches one row, but a future admin
-- screen deciding a queue in one UPDATE must not fan out into a message each.

create trigger player_claims_notify
  after insert or update or delete on public.player_claims
  for each statement execute function public.notify_topic_change('player_claims');

-- app_users as well, and it is the one that actually carries the outcome.
--
-- The claim row going to 'approved' is the paperwork; `app_users.player_id`
-- is the link, and it is what `useSession` and every "who am I" read depend
-- on. It also covers the other half of the same problem: an admin changing
-- somebody's ROLE currently leaves that person's session reporting the old
-- one until they sign out and back in, which reads as the promotion not
-- having happened.
--
-- Nothing about the row travels, only the topic — the same reason
-- role_permissions could take this trigger in 0045 despite deciding access.
create trigger app_users_notify
  after insert or update or delete on public.app_users
  for each statement execute function public.notify_topic_change('app_users');
