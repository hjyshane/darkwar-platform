import { useId } from 'react';
import { useChannelNames } from '../lib/channels';

/** The Discord channel picker every editor shows.
 *
 * Nothing ticked means "wherever this kind of post normally goes" — the channel
 * set for the event in settings — which is what almost every post wants. The
 * column exists for the ones that do not: "the dashboard is down tonight" and
 * "here is the war plan for Saturday" are both notices and belong in different
 * rooms, and a maintenance window belongs in two rooms at once (0133).
 *
 * CHECKBOXES RATHER THAN `<select multiple>`. A multiple select needs a
 * ctrl-click to pick a second option and a ctrl-click to keep the first, which
 * on a form somebody fills in once a week is a trap: the common accident is
 * REPLACING the choice while believing you added to it. Here every room is a
 * box, the state is visible without opening anything, and there is nothing to
 * discover.
 *
 * The fallback is a box too, and ticking it clears the rest — "the usual place"
 * is a choice among the others rather than the absence of one, so it belongs in
 * the same list and not as a separate control that contradicts it.
 */
export function ChannelField({
  id,
  value,
  onChange,
  fallbackLabel,
}: {
  id: string;
  /** The channel names this post announces in. Empty means the settings
   * default for its kind. */
  value: string[];
  onChange: (next: string[]) => void;
  /** What the empty option says, e.g. "Default for notices". */
  fallbackLabel: string;
}) {
  const { data: channels } = useChannelNames();
  const groupId = useId();
  // Channels the row already names but this reader cannot list, kept so an
  // unrelated edit cannot blank the routing on save. Appended rather than
  // sorted in: they are the exception and the list a writer knows is the list
  // they should read first.
  const known = channels ?? [];
  const options = [...known, ...value.filter((name) => !known.includes(name))];
  const toggle = (name: string, on: boolean) => {
    onChange(
      on
        ? [...value, name].filter((n, i, all) => all.indexOf(n) === i)
        : value.filter((n) => n !== name),
    );
  };
  return (
    <fieldset aria-describedby={`${groupId}-hint`} className="field" id={id}>
      <legend>Discord channels</legend>
      <div className="field-checks">
        <label>
          <input checked={value.length === 0} onChange={() => onChange([])} type="checkbox" />
          {fallbackLabel}
        </label>
        {options.map((name) => (
          <label key={name}>
            <input
              checked={value.includes(name)}
              onChange={(event) => toggle(name, event.target.checked)}
              type="checkbox"
            />
            #{name}
          </label>
        ))}
      </div>
      <p className="subtle" id={`${groupId}-hint`}>
        Tick more than one to announce in more than one room. Each gets its own message.
      </p>
    </fieldset>
  );
}
