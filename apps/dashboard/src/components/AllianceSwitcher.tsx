import type { MyAlliance } from '../lib/useMyAlliances';

/** The one control for "which of my alliances am I looking at".
 *
 * Rendered only when there is a choice: a member of one alliance never sees
 * it, a member of two (or an admin, once two are pinned) does. Buttons rather
 * than a select because there are two or three and each should be one click.
 * aria-pressed carries the current one, so the visible state and the
 * accessible state are the same attribute.
 */
export function AllianceSwitcher({
  alliances,
  activeId,
  onSwitch,
  className,
}: {
  alliances: MyAlliance[];
  activeId: string | null;
  onSwitch: (allianceId: string) => void;
  className?: string;
}) {
  if (alliances.length < 2) {
    return null;
  }
  return (
    <fieldset className={`alliance-switch ${className ?? ''}`.trim()}>
      <legend className="visually-hidden">Viewing alliance</legend>
      {alliances.map((alliance) => (
        <button
          key={alliance.alliance_id}
          type="button"
          aria-pressed={alliance.alliance_id === activeId}
          title={`${alliance.name} · ${alliance.server_id} · ${alliance.role}`}
          onClick={() => onSwitch(alliance.alliance_id)}
        >
          {alliance.code || alliance.name}
        </button>
      ))}
    </fieldset>
  );
}
