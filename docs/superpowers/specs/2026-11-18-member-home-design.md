# Member Home and a shorter member menu — design (DRAFT)

2026-11-18. From the owner's "Member view mockups" (pages 1 and 4) and the website feedback
triage (`docs/website-feedback-2026-11.md`): a member who signs in should land on ONE screen
with what they need this week, and see a short menu, not eleven entries and ~40 screens.

Owner's changes to the mockup (2026-11-18): **no gift-code card**; **the calculator lives inside
the upgrade card** ("Your next moves") rather than as its own menu entry.

Status: owner's answers in §6 (2026-11-18). Phase 1 in progress.

## 1. What a member gets

**Home** (`#/home`, the landing screen for everyone signed in — members, officers and admins):

| Card | Shows | Source today | Phase |
|---|---|---|---|
| Hive move | My tile in the live plan as `#580[X:… Y:…]`, Copy, See the plan; "changed HH:MM by X" | `hive_formations` (0165/0330: `is_active`, `edited_at`, `edited_by_name`), `hive_formation_board` (0166/0330); `MyTile` logic in `features/hive/HivePage.tsx` | 1 |
| ↳ "your tile did / did not move" | **Dropped for now** (owner): nothing records a previous position (a save deletes and re-inserts tiles). The card shows only when and by whom the plan last changed | — |
| This week | Today: Alliance Duel theme. This week: Black Gold — my team, starter/substitute, the team's time; my objective if a live battle plan has one | `game_event_themes` + `serverNow()` (0248, `features/eventGuide`); my row in `black_money_signup_snapshots` (0178); `alliance_event_times` (0249); `bgb_plans` (0331) | 1 |
| Upgrades + calculator | **Calculator entry** (pick building / chip / gear → the calculator page, prefilled); later "your next moves" (top 3 recommendations for my account, each with "What it costs" → calculator) | Calculator exists (`#/calculator?kind=…&subject=…`). Recommendations: `recommend_step_pairs` (0247) + `account_state_latest` (owner-only) + client ranking in `features/planner/recommend.ts` — heavy, needs a linked account with collected state | 1: calculator entry. 2: recommendations |
| From your officers | Pinned notices and pinned guides | `announcements.pinned` (0034/0108), `guides.pinned` (0078); `AnnouncementsBlock`, `GuidesBlock` in `features/overview` | 1 |

Header line: my character name and server (from `useSession().playerId` + a `players` lookup).

Not on Home (owner, 2026-11-18): gift codes.

## 2. The member menu

| Mockup (p.4) | This design |
|---|---|
| Home · Guides · Calculator · Hive · Map · Alliance | **The same six** (owner): Calculator stays in the menu AND is reached from Home's upgrade card |

- **Guides** = alliance guides + notices + event guide.
- **Alliance** = roster, participation, Black Gold (lineup, battle plan, battlefield).
- Everything else (rankings, migration, members tables, calendar, shop value, seasons…) stays at
  its address but has **no entry for a plain member**. Officers and admins keep today's full menu
  plus Home.
- Built in `buildNav` (`lib/shellNav.ts`) as a member variant, not via Tab visibility: that
  setting can only hide entries, not regroup them (0295). Tab visibility keeps working on top.

## 3. Mobile

The mockup shows a bottom tab bar. Today the shell has only a drawer below 56rem
(`components/shell/AppShell.tsx`, `shell.css`). Phase 3: a bottom bar with the six member
entries on narrow screens; the drawer stays for officers.

## 4. Phases

1. **Home with cards 1, 2, 4 and the calculator entry; members land on it.** Dashboard only, no
   migration (every source is already member-readable).
2. **Member menu** (§2) in `buildNav`, tests for member vs officer vs admin.
3. **Recommendations** in the upgrade card; **mobile bottom bar**.

Each phase is one PR, merged to `main` = released (CLAUDE.md), so each must stand alone.

## 5. Tests

- Pure helpers (`homeModel.ts`): today's duel theme from server time; my BGB line from a signup
  row (starter / substitute / not signed up); tile-moved from the stored and current coordinate;
  which notices show.
- Component test with mocked data: member sees their tile first; no live plan → plain line; no
  linked character → the link-your-account line, not an error.
- Nav: a member's entries are exactly the six; officer and admin keep theirs.

## 6. Decisions (owner, 2026-11-18)

1. **Everyone lands on Home** — members, officers, admins. Overview stays in the menu for those
   who have it.
2. **Member menu has six entries**, Calculator included (plus the entry inside the upgrade card).
3. **No "your tile moved" line** for now; only "changed HH:MM by X".
4. **Black Gold on Home: team, starter/substitute, the team's time** (and my objective when a live
   battle plan has one). `time_index_record` stays undecoded.
5. (earlier) No gift-code card; calculator inside the upgrade card.
