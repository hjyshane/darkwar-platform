import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { supabase } from '../../lib/supabase';

/** Discord webhooks, and which events go down them.
 *
 * TWO STORES, and the split is the point. A webhook URL is a credential —
 * anybody holding it can post to that channel, as anyone — and `app_settings` is
 * readable by every member (0032 grants it, on purpose, because the dashboard
 * renders from it). So:
 *
 *   notification_channels   the URL. Admin-only, select included.
 *   app_settings            which event goes to which channel NAME. No secret.
 *
 * A member can therefore see that departures are announced without being able to
 * announce one. 44_discord_notifications_test proves both halves.
 *
 * NOTHING HERE POSTS ANYTHING. The collector's `dw-notify` does the sending; this
 * screen writes rows. "Send test" enqueues one message and the worker picks it up
 * on its next pass — up to five minutes. That is deliberate: a button that posted
 * directly from the browser would need the URL in the browser.
 */
interface Channel {
  channel: string;
  webhook_url: string;
  enabled: boolean;
  last_delivered_at: string | null;
  last_error: string | null;
}

interface Routing {
  [event: string]: { channel: string; enabled: boolean } | undefined;
}

/** The events the worker knows how to send. Listed here rather than derived from
 * whatever happens to be in the settings row, so an event the collector does not
 * implement cannot be switched on. */
const EVENTS: { event: string; label: string; note: string }[] = [
  {
    event: 'rank_period',
    label: 'Rank period built',
    note: 'Tier counts, why anybody is ungraded, and who changed rank. Once per period per scoring version.',
  },
  {
    event: 'departures',
    label: 'Member left',
    note: 'One message per departure. Only when a complete roster capture confirms it, and only after six hours — a capture still in progress looks exactly like half the alliance leaving.',
  },
  {
    event: 'guides',
    label: 'Guide published',
    note: 'The title, kind and body of a guide, when somebody publishes it. Editing a published guide does not post again; unpublishing and publishing does.',
  },
];

interface Outbox {
  notification_id: number;
  channel: string;
  event: string;
  title: string;
  created_at: string;
  delivered_at: string | null;
  attempts: number;
  last_error: string | null;
}

async function fetchAll() {
  const [channels, settings, outbox] = await Promise.all([
    supabase
      .from('notification_channels')
      .select('channel, webhook_url, enabled, last_delivered_at, last_error')
      .order('channel'),
    supabase.from('app_settings').select('value').eq('key', 'discord_notifications').maybeSingle(),
    supabase
      .from('notification_outbox')
      .select(
        'notification_id, channel, event, title, created_at, delivered_at, attempts, last_error',
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ]);
  if (channels.error) {
    throw new Error(`channel query failed: ${channels.error.message}`);
  }
  if (settings.error) {
    throw new Error(`routing query failed: ${settings.error.message}`);
  }
  if (outbox.error) {
    throw new Error(`outbox query failed: ${outbox.error.message}`);
  }
  return {
    channels: (channels.data ?? []) as Channel[],
    routing: ((settings.data?.value ?? {}) as Routing) ?? {},
    outbox: (outbox.data ?? []) as Outbox[],
  };
}

export function NotificationsSetting() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('reports');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['discord-notifications'],
    queryFn: fetchAll,
  });

  function report(text: string, bad = false): void {
    setFailed(bad);
    setMessage(text);
    void queryClient.invalidateQueries({ queryKey: ['discord-notifications'] });
  }

  const saveChannel = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      // Checked here as well as by the worker, because the failure otherwise
      // happens five minutes later in a log nobody is reading.
      if (!trimmed.startsWith('https://discord.com/api/webhooks/')) {
        throw new Error(
          'That does not look like a Discord webhook URL. In Discord: channel settings → Integrations → Webhooks → Copy Webhook URL.',
        );
      }
      const { error: saveError } = await supabase
        .from('notification_channels')
        .upsert({ channel: name.trim(), webhook_url: trimmed, enabled: true });
      if (saveError) {
        throw new Error(saveError.message);
      }
    },
    onSuccess: () => {
      setUrl('');
      report(`Saved ${name.trim()}. Nothing has been posted yet — use Send test.`);
    },
    onError: (mutationError: Error) => report(mutationError.message, true),
  });

  const toggleChannel = useMutation({
    mutationFn: async (row: Channel) => {
      const { error: toggleError } = await supabase
        .from('notification_channels')
        .update({ enabled: !row.enabled })
        .eq('channel', row.channel);
      if (toggleError) {
        throw new Error(toggleError.message);
      }
    },
    onSuccess: () => report('Channel updated.'),
    onError: (mutationError: Error) => report(mutationError.message, true),
  });

  const removeChannel = useMutation({
    mutationFn: async (channel: string) => {
      const { error: deleteError } = await supabase
        .from('notification_channels')
        .delete()
        .eq('channel', channel);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
    },
    onSuccess: () =>
      report('Channel removed. The URL is gone — Discord will have to give you a new one.'),
    onError: (mutationError: Error) => report(mutationError.message, true),
  });

  const saveRouting = useMutation({
    mutationFn: async (next: Routing) => {
      const { error: routingError } = await supabase
        .from('app_settings')
        .upsert({ key: 'discord_notifications', value: next });
      if (routingError) {
        throw new Error(routingError.message);
      }
    },
    onSuccess: () => report('Saved. The collector picks this up on its next pass.'),
    onError: (mutationError: Error) => report(mutationError.message, true),
  });

  // Enqueue, not post. The URL never reaches the browser's outbound requests —
  // `dw-notify` holds it and does the sending.
  const sendTest = useMutation({
    mutationFn: async (channel: string) => {
      const { error: testError } = await supabase.from('notification_outbox').insert({
        channel,
        event: 'test',
        // The same key the worker's own helper uses, and it carries no
        // timestamp: pressing this twice must post once, or somebody unsure
        // whether it worked fills the channel finding out.
        idempotency_key: `test:${channel}`,
        title: 'Dark War dashboard',
        body: `Notifications for **${channel}** are wired up.`,
      });
      if (testError) {
        throw new Error(
          testError.code === '23505'
            ? 'Already queued a test for this channel. Delete that row, or just wait — the collector sends it within five minutes.'
            : testError.message,
        );
      }
    },
    onSuccess: () => report('Queued. The collector posts it within five minutes.'),
    onError: (mutationError: Error) => report(mutationError.message, true),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the notification settings: {error.message}</p>;
  }

  const channels = data?.channels ?? [];
  const routing = data?.routing ?? {};

  return (
    <>
      <p className="subtle">
        The collector does the posting, not this page — nothing here sends anything on its own, and
        a queued message goes out within five minutes. The webhook URL is stored where only an admin
        can read it, which is why it is not with the other settings.
      </p>

      {message !== null && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <h4>Channels</h4>
      {channels.length === 0 ? (
        <p className="empty">
          No channel yet. In Discord: channel settings → Integrations → Webhooks → New Webhook →
          Copy Webhook URL.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label" scope="col">
                  Channel
                </th>
                <th scope="col">On</th>
                <th scope="col">Last delivered</th>
                <th className="label" scope="col">
                  Last error
                </th>
                <th scope="col">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr key={row.channel}>
                  <td className="label">{row.channel}</td>
                  <td>
                    <input
                      aria-label={`Enable ${row.channel}`}
                      checked={row.enabled}
                      onChange={() => toggleChannel.mutate(row)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    {/* A dash means never, and never is the state right after
                        pasting a URL — the moment an admin most needs telling. */}
                    {row.last_delivered_at === null ? (
                      <span className="subtle">never</span>
                    ) : (
                      <FreshnessBadge capturedAt={row.last_delivered_at} />
                    )}
                  </td>
                  <td className="label">
                    {row.last_error === null ? <span className="subtle">—</span> : row.last_error}
                  </td>
                  <td>
                    <div className="row">
                      <button onClick={() => sendTest.mutate(row.channel)} type="button">
                        Send test
                      </button>
                      <button onClick={() => removeChannel.mutate(row.channel)} type="button">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4>Add or replace a channel</h4>
      <div className="row">
        <label>
          Name
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          Webhook URL
          {/* type=password: this is a credential and the screen may be shared. */}
          <input
            autoComplete="off"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            type="password"
            value={url}
          />
        </label>
        <button
          disabled={saveChannel.isPending || url.trim() === '' || name.trim() === ''}
          onClick={() => saveChannel.mutate()}
          type="button"
        >
          Save
        </button>
      </div>

      <h4>What gets announced</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label" scope="col">
                Event
              </th>
              <th scope="col">On</th>
              <th className="label" scope="col">
                Channel
              </th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((entry) => {
              const current = routing[entry.event] ?? { channel: '', enabled: false };
              return (
                <tr key={entry.event}>
                  <td className="label">
                    {entry.label}
                    <div className="stat-note">{entry.note}</div>
                  </td>
                  <td>
                    <input
                      aria-label={`Announce ${entry.label}`}
                      checked={current.enabled}
                      onChange={() =>
                        saveRouting.mutate({
                          ...routing,
                          [entry.event]: { ...current, enabled: !current.enabled },
                        })
                      }
                      type="checkbox"
                    />
                  </td>
                  <td className="label">
                    <select
                      aria-label={`Channel for ${entry.label}`}
                      onChange={(event) =>
                        saveRouting.mutate({
                          ...routing,
                          [entry.event]: { ...current, channel: event.target.value },
                        })
                      }
                      value={current.channel}
                    >
                      <option value="">— pick a channel —</option>
                      {channels.map((row) => (
                        <option key={row.channel} value={row.channel}>
                          {row.channel}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Why there is no "collector offline" event here: the process that would
          report a dead collector runs on the same machine, so it is dead too. An
          alert that cannot fire in the one case it exists for is worse than none,
          because silence then reads as healthy. */}
      <p className="subtle">
        There is no alert for the collector going quiet. Whatever would send it runs on the same PC,
        so it would be down as well — and an alert that cannot fire when it matters makes silence
        look like health. That one needs something outside this machine.
      </p>

      <h4>Recently queued</h4>
      {(data?.outbox ?? []).length === 0 ? (
        <p className="empty">Nothing queued yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label" scope="col">
                  Message
                </th>
                <th scope="col">Queued</th>
                <th scope="col">Sent</th>
                <th className="num" scope="col">
                  Tries
                </th>
                <th className="label" scope="col">
                  Error
                </th>
              </tr>
            </thead>
            <tbody>
              {(data?.outbox ?? []).map((row) => (
                <tr key={row.notification_id}>
                  <td className="label">
                    {row.title}
                    <div className="stat-note">
                      {row.event} → {row.channel}
                    </div>
                  </td>
                  <td>
                    <FreshnessBadge capturedAt={row.created_at} />
                  </td>
                  <td>
                    {row.delivered_at === null ? (
                      <span className="badge badge-missing">queued</span>
                    ) : (
                      <FreshnessBadge capturedAt={row.delivered_at} />
                    )}
                  </td>
                  <td className="num">{row.attempts}</td>
                  <td className="label">
                    {row.last_error === null ? <span className="subtle">—</span> : row.last_error}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
