# The Discord bot

`apps/discord-bot` answers slash commands from reference tables compiled into
the Worker. It reads **nothing** — no Supabase client, no database credential,
no network call outbound. That is the property to preserve; the moment a
command needs live data, most of what follows changes.

## Why a Worker and not the collector

The collector is a Windows process tree on one desk. A bot living there is
offline whenever that machine is. An interactions endpoint is plain HTTP
request/response with no gateway socket to hold open, which is what a Worker
does well.

This does not contradict `apps/dashboard/wrangler.jsonc`, which refuses a Worker
in front of the dashboard's static assets on the grounds that it would be a
second place for auth to be wrong. This Worker is a separate deployment sitting
in front of nothing. The dashboard does not route through it.

## One-time setup

Uses the existing **darkwar** Discord application — the same one behind the
dashboard's Discord OAuth. No second app.

1. **Deploy the Worker.**

   ```
   pnpm --filter @dw/discord-bot exec wrangler deploy
   ```

   Note the `*.workers.dev` URL it prints.

2. **Give it the public key.** Developer portal → General Information → Public
   Key.

   ```
   pnpm --filter @dw/discord-bot exec wrangler secret put DISCORD_PUBLIC_KEY
   ```

   Not strictly a secret — it verifies signatures, it cannot create them — but
   it differs per application and does not belong in git.

3. **Point Discord at the Worker.** Developer portal → General Information →
   Interactions Endpoint URL → the Worker URL → Save.

   Discord will not save it until the endpoint proves itself. It sends requests
   with deliberately invalid signatures and expects **401**. An endpoint that
   answers 200 to those is rejected. This is the platform enforcing the
   security property for you, and it is why `verify.ts` has more negative tests
   than positive ones.

4. **Register the commands.** Deploying does not register anything — the two
   are separate steps, and forgetting this one is the usual first confusion:
   the code is live, the endpoint answers, and no command appears.

   ```
   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
     pnpm --filter @dw/discord-bot register
   ```

   The bot token is a **real secret**. It is used here, from your own machine,
   and by nothing else — the Worker never needs it, because answering an
   interaction is a reply to an inbound request, not an outbound API call. Do
   not put it in `wrangler secret`, `.env`, or the repo.

   `DISCORD_GUILD_ID` scopes the commands to one server: they appear instantly
   and only there. Omit it for global commands, which take up to an hour to
   propagate and show up in every server the app is in.

## Adding a command

One new file and one line.

1. Copy `src/commands/gear.ts`. It is the worked example and its comment says
   what each of the three parts is for.
2. Append it to `ALL` in `src/commands/registry.ts`.
3. `pnpm --filter @dw/discord-bot test` — the registry tests check the new
   command's name and description against Discord's rules, and the reply tests
   run it to confirm the output fits inside an embed.
4. Deploy, then **register again**. A new command that is deployed but not
   registered does not exist as far as Discord is concerned.

`PUT` is a replace, not an append: whatever `register` posts becomes the
complete list, so a command deleted from the registry disappears from Discord.

## The two traps

- **An oversized embed is not rejected, it is dropped.** Discord returns
  success and the message simply never appears, which from the channel is
  indistinguishable from the bot being down. `reply.ts` is the only place that
  knows the limits and every command goes through it. `notify/compose.py` hit
  this first on the webhook path; the numbers are the same, restated because
  the two live in different languages and neither can import the other.
- **Deploy and register are separate.** Renaming a command and deploying
  without re-registering leaves Discord offering a name the Worker no longer
  has. The router answers that case with an ephemeral "I do not have a command
  called X any more" rather than silence, because silence reads as an outage.

## `/gear` is a placeholder

The numbers in `src/commands/gear.ts` are **invented** and are not the real
game values. It exists to fix the shape the real commands will take. Its test
deliberately pins the shape and not the values, so filling in real figures does
not turn the suite red. Delete the warning at the top of the file when the real
table goes in.
