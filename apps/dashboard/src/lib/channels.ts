import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** The Discord channel NAMES a writer may route a post to (0125, 0127).
 *
 * Not `notification_channels`: that table holds the webhook URL and is
 * admin-only including select (0076), so anybody else reading it gets an empty
 * list — and an empty list here is a dropdown that cannot be filled in, with a
 * foreign key waiting to reject whatever gets typed instead.
 *
 * Shared by three editors now — the schedule's boards, notices and guides —
 * which is why it moved out of the schedule feature. One query key, so opening
 * two of those screens in a session asks once.
 *
 * SWITCHED-ON CHANNELS ONLY. The view carries `enabled` precisely so a caller
 * can ask this, and for a while none of them did: every editor offered the
 * disabled ones too, and picking one produced a post that announced NOWHERE.
 * Both deliverers — `NotifyWorker.deliver` and `internal.deliver_owned_alerts`
 * — look the webhook up with `enabled` in the condition and skip the row when
 * they find nothing, deliberately, so that a half-configured channel does not
 * burn the retry budget. Correct on their side; it just means the only place
 * the mistake can be caught is here, before it is offered.
 *
 * Turning a channel OFF does not blank the posts already routed to it. Every
 * editor keeps a name the row carries but this list does not have — the
 * checkboxes in `ChannelField`, the extra `<option>` in the schedule's boards —
 * so the routing survives an unrelated edit and comes back when the channel is
 * switched on again.
 */
export function useChannelNames() {
  return useQuery({
    queryKey: ['notification-channel-names'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('notification_channel_names')
        .select('channel, enabled')
        .eq('enabled', true)
        .order('channel');
      if (error !== null) {
        throw error;
      }
      return (data ?? []).map((row) => row.channel).filter((name): name is string => name !== null);
    },
    // Channels change when an admin adds a webhook, which is rarely.
    staleTime: 10 * 60_000,
  });
}
