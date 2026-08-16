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
 */
export function useChannelNames() {
  return useQuery({
    queryKey: ['notification-channel-names'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('notification_channel_names')
        .select('channel, enabled')
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
