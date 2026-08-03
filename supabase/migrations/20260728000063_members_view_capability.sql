-- 0063: the roster becomes a members-only screen.
--
-- Every other capability in the registry is a WRITE. This is the first read
-- one, and it is worth being precise about what it does and does not do.
--
-- What it does: decides whether the Members tab is offered at all. Until now
-- the tab rendered for everyone and a logged-out reader saw a roster of
-- names and power with every contribution column dashed out — a screen that
-- exists mainly to say "not for you".
--
-- What it does NOT do: hide the roster. `players` is world-readable by
-- design, because it is what the cross-server boards, the server pages and
-- the arena name resolution all read. The same names and power are still
-- reachable from those screens, and this migration does not change that.
-- The figures that are actually alliance-internal — contribution, presence,
-- rank, growth — were already member-only (0020, 0024, 0059) and stay so
-- whatever this row says.
--
-- So: presentation, decided in the database so an admin can change it
-- without a deploy, and not a claim that the roster is now secret. Saying
-- otherwise in a comment would repeat 0049's mistake, where a comment
-- asserted a protection that did not exist.
--
-- Keyed on the ROLE, not on app_users.game_rank. The request was "R1 and
-- above", and R1 is the bottom of the R1-R5 scale, so that reads as "an
-- actual alliance member rather than any signed-in account" — which is what
-- the `member` role already means. Wiring it to game_rank instead would
-- have locked out everyone, since no account has a rank assigned, and would
-- have broken the rule 0045 set down and 26_permissions_test pins: a
-- promotion in the game must not change what this app permits.

insert into public.capabilities (capability, label, description, sort_order)
values
  ('members.view', 'See the Members screen',
   'The alliance roster and its columns. Contribution and presence stay '
   'member-only on their own tables regardless of this.', 5);

-- viewer is deliberately absent rather than false, and both read the same:
-- isAllowed() and has_permission() treat a missing row as a denial, which
-- is the behaviour a permission grid should have. It is written out anyway
-- so the admin grid shows a box to tick rather than a gap.
insert into public.role_permissions (role, capability, allowed) values
  ('viewer', 'members.view', false),
  ('member', 'members.view', true),
  ('officer', 'members.view', true),
  ('admin', 'members.view', true);
