import { useChannelNames } from '../lib/channels';

/** The Discord channel picker every editor shows.
 *
 * Empty means "wherever this kind of post normally goes" — the channel set for
 * the event in settings — which is what almost every post wants. The column
 * exists for the ones that do not: "the dashboard is down tonight" and "here is
 * the war plan for Saturday" are both notices and belong in different rooms.
 */
export function ChannelField({
  id,
  value,
  onChange,
  fallbackLabel,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** What the empty option says, e.g. "Default for notices". */
  fallbackLabel: string;
}) {
  const { data: channels } = useChannelNames();
  return (
    <div className="field">
      <label htmlFor={id}>Discord channel</label>
      <select id={id} onChange={(e) => onChange(e.target.value)} value={value}>
        <option value="">{fallbackLabel}</option>
        {(channels ?? []).map((name) => (
          <option key={name} value={name}>
            #{name}
          </option>
        ))}
        {/* A channel the row already carries but this reader cannot list.
            Dropping it silently would blank the routing on the next save of an
            unrelated field. */}
        {value !== '' && !(channels ?? []).includes(value) && (
          <option value={value}>#{value}</option>
        )}
      </select>
    </div>
  );
}
