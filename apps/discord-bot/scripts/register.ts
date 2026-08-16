/** Telling Discord which commands exist.
 *
 * DEPLOYING THE WORKER DOES NOT REGISTER ANYTHING. The two are separate steps
 * and forgetting this one is the usual first confusion: the code is live, the
 * endpoint answers, and no slash command appears in Discord because Discord
 * was never told the command exists.
 *
 * Run it after adding or renaming a command:
 *
 *   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... pnpm --filter @dw/discord-bot register
 *
 * THE BOT TOKEN IS A REAL SECRET and belongs nowhere near the repo or the
 * Worker. It is used here, from your own machine, and by nothing else — the
 * Worker never needs it, because answering an interaction is a reply to an
 * inbound request, not an outbound API call.
 *
 * GUILD-SCOPED BY DEFAULT. Guild commands appear instantly; global ones take up
 * to an hour to propagate and are visible in every server the app is in. For a
 * private alliance server, guild scope is both faster and narrower. Set
 * DISCORD_GUILD_ID to the server's id (Discord → right-click the server →
 * Copy Server ID, with Developer Mode on).
 *
 * PUT is a REPLACE, not an append: whatever this posts becomes the complete
 * list, so a command deleted from the registry disappears from Discord as it
 * should.
 */

import { DEFINITIONS } from '../src/commands/registry.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. See the comment at the top of this file.`);
  }
  return value;
}

async function main(): Promise<void> {
  const applicationId = required('DISCORD_APPLICATION_ID');
  const token = required('DISCORD_BOT_TOKEN');
  const guildId = process.env.DISCORD_GUILD_ID;

  const url =
    guildId === undefined || guildId === ''
      ? `https://discord.com/api/v10/applications/${applicationId}/commands`
      : `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(DEFINITIONS),
  });

  if (!response.ok) {
    // Printed in full because Discord's validation errors name the offending
    // field, and a bare status tells you nothing about which option was wrong.
    throw new Error(
      `Discord refused the registration (${response.status}): ${await response.text()}`,
    );
  }

  // `process.stdout.write`, not `console.log`, which the repo lints against.
  // The rule is aimed at debug statements left in shipped code; here stdout is
  // the tool's entire output, so the answer is to write to it deliberately
  // rather than to carve out an exemption that would also cover real strays.
  const scope = guildId === undefined || guildId === '' ? 'globally' : `in guild ${guildId}`;
  const lines = [
    `Registered ${DEFINITIONS.length} command(s) ${scope}:`,
    ...DEFINITIONS.map((definition) => `  /${definition.name} — ${definition.description}`),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
