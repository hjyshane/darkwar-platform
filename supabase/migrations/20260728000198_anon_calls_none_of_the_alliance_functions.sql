-- 0198: the multi-alliance functions are for signed-in callers only.
--
-- Found on production after 0192-0197 were pushed, by asking the catalogue
-- rather than trusting the migrations: `anon` held EXECUTE on fifteen of the
-- new functions. The migrations said `revoke all ... from public` and granted
-- `authenticated`, which is right for the local stack and not enough on the
-- hosted one — the platform's `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- ROUTINES TO anon, authenticated` is a DIRECT grant that revoking from
-- public does not touch. 57_anon_callable's header names exactly this, and
-- 0095 fixed the same thing for record_departure().
--
-- Most of them refuse a caller with no uid, or return nothing for one. Three
-- answered: alliance_setting (the rank tiers, which 0168 took away from anon
-- along with app_settings itself), joinable_alliances (the names of our
-- alliances), account_in_view (a yes/no about any account id). None of them
-- has a reason to be callable signed out, so all of them are revoked, and the
-- door is closed by statement rather than by each body's own check.
--
-- Deliberately still open: active_alliance(), current_app_role() and
-- primary_own_alliance() — a signed-out page asks what role it has (0045),
-- and the other two are what that answer is computed from.
--
-- Every statement is a no-op on a database that never had the grant, which
-- is the local stack and CI.

revoke execute on function public.set_membership(uuid, uuid, public.app_role) from anon;
revoke execute on function public.my_alliances() from anon;
revoke execute on function public.joinable_alliances() from anon;
revoke execute on function public.linked_player_ids() from anon;
revoke execute on function public.unlink_player(uuid) from anon;
revoke execute on function public.alliance_setting(text, uuid) from anon;
revoke execute on function public.save_alliance_setting(text, jsonb) from anon;
revoke execute on function public.account_in_view(uuid) from anon;
revoke execute on function public.waiting_to_join() from anon;
revoke execute on function public.leave_active_alliance() from anon;
revoke execute on function public.freeze_alliance_settings() from anon, authenticated;
revoke execute on function public.refuse_other_alliance(uuid) from anon, authenticated;
