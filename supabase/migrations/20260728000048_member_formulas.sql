-- 0048: a formula runs on a member, not on the alliance.
--
-- The formula feature shipped computing over alliance totals and rendering a
-- tile on the overview. The one formula anybody actually wrote was
-- `(weekly_donation * 0.4) + (duel_weekly * 0.6)`, labelled "Activity
-- Score" — which is a per-member score. Computed over the alliance it was
-- one number for everyone, which is not what an activity score is.
--
-- The names were already right: `weekly_donation` and `duel_weekly` are
-- columns the roster carries per member. What was wrong was the row they ran
-- on. So the expressions move to `member_formulas` and are evaluated once
-- per member, appearing as columns beside the ones they are made of.
--
-- A new key rather than reusing `overview_formulas`, because the same text
-- means something different now — reusing it would have made an
-- alliance-wide expression silently become a member one, and there would be
-- no way afterwards to tell which a stored formula had been written as.
-- Moving the value across is a deliberate step, taken here, once.
insert into public.app_settings (key, value)
select 'member_formulas', value
from public.app_settings
where key = 'overview_formulas'
on conflict (key) do nothing;

delete from public.app_settings where key = 'overview_formulas';
