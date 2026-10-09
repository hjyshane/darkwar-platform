import { formatCoordinate } from '@dw/ui';
import { StatTile } from '../../components/StatTile';
import { formatAge } from '../../lib/freshness';
import {
  type Atlas,
  type AtlasBase,
  allianceColor,
  allianceSummary,
  byPower,
  formatCopyCoordinate,
  formatPower,
  isShielded,
  isStale,
} from './atlas';

const plain = new Intl.NumberFormat('en');

/** A coloured disc standing in for the emblem: the alliance's own colour and the
 * first letter of its tag. The game's art is not on this screen. */
function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span aria-hidden="true" className="atlas-badge" style={{ background: color }}>
      {text.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One base in a ranked list: name, HQ and coordinate on the left, power on the right. */
export function BaseRow({
  base,
  on,
  onChoose,
}: {
  base: AtlasBase;
  on: boolean;
  onChoose: (base: AtlasBase) => void;
}) {
  return (
    <li>
      <button
        className={on ? 'map-result--on atlas-base-row' : 'atlas-base-row'}
        onClick={() => onChoose(base)}
        type="button"
      >
        <span className="atlas-base-row__who">
          <strong>{base.name ?? 'unnamed'}</strong>
          <span className="subtle">
            {base.hq !== null && `HQ ${base.hq} · `}
            {formatCopyCoordinate(base.at)}
          </span>
        </span>
        <span className="atlas-base-row__power">{formatPower(base.power)}</span>
      </button>
    </li>
  );
}

/** An alliance on this map: who, how many bases, how strong, and its strongest. */
export function AllianceDetail({
  atlas,
  index,
  now,
  isOurs,
  selectedUid,
  onBack,
  onCentre,
  onChoose,
}: {
  atlas: Atlas;
  index: number;
  now: Date;
  isOurs: boolean;
  selectedUid: number | null;
  onBack: () => void;
  onCentre: () => void;
  onChoose: (base: AtlasBase) => void;
}) {
  const alliance = atlas.alliances[index];
  if (alliance === undefined) return null;
  const summary = allianceSummary(atlas, index, now);
  const color = allianceColor(alliance.id, isOurs);
  return (
    <section aria-label="Alliance" className="atlas-detail">
      <div className="atlas-detail__bar">
        <button className="linklike" onClick={onBack} type="button">
          ‹ All alliances
        </button>
        <button className="atlas-detail__action" onClick={onCentre} type="button">
          Centre on the alliance
        </button>
      </div>
      <div className="atlas-detail__head" style={{ borderColor: color }}>
        <Badge color={color} text={alliance.code ?? '?'} />
        <div>
          <strong>[{alliance.code ?? '?'}]</strong>
          <span className="subtle">
            {alliance.name ?? ''}
            {isOurs && ' · your alliance'}
          </span>
        </div>
      </div>
      <div className="strip">
        <StatTile label="Bases" value={plain.format(summary.bases)} />
        <StatTile label="Shielded" value={plain.format(summary.shielded)} />
        <StatTile label="Real power" value={formatPower(summary.realPower)} />
      </div>
      <p className="subtle">
        {summary.profilesRead} of {summary.bases} profiles read.
      </p>
      <h3 className="atlas-detail__title">Strongest here</h3>
      <ol className="map-results atlas-strongest">
        {summary.strongest.map((base) => (
          <BaseRow
            base={base}
            key={base.gameUid}
            on={base.gameUid === selectedUid}
            onChoose={onChoose}
          />
        ))}
      </ol>
    </section>
  );
}

/** One base: who, how strong, shielded or not, where, and its alliance's strongest. */
export function BaseDetail({
  atlas,
  base,
  now,
  isOurs,
  copied,
  onBack,
  onClose,
  onCopy,
  onChoose,
}: {
  atlas: Atlas;
  base: AtlasBase;
  now: Date;
  isOurs: boolean;
  copied: string | null;
  onBack: () => void;
  onClose: () => void;
  onCopy: (base: AtlasBase) => void;
  onChoose: (base: AtlasBase) => void;
}) {
  const alliance = base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
  const color = allianceColor(alliance?.id ?? null, isOurs);
  const shielded = isShielded(base, now) && base.shieldEnd !== null;
  const mates =
    alliance === undefined
      ? []
      : byPower(
          atlas.bases.filter(
            (other) =>
              other.alliance === base.alliance &&
              other.gameUid !== base.gameUid &&
              other.power !== null,
          ),
        ).slice(0, 12);
  return (
    <section aria-label="Base" className="atlas-detail">
      <div className="atlas-detail__bar">
        <button className="linklike" onClick={onBack} type="button">
          {alliance?.code ? `‹ [${alliance.code}]` : '‹ All alliances'}
        </button>
      </div>
      <div className="atlas-detail__head" style={{ borderColor: color }}>
        <Badge color={color} text={base.name ?? '?'} />
        <div>
          <strong>{base.name ?? 'unnamed'}</strong>
          <span className="subtle">
            {alliance ? `[${alliance.code ?? '?'}] ${alliance.name ?? ''}` : 'No alliance seen'}
          </span>
        </div>
        <button aria-label="Close" className="atlas-detail__close" onClick={onClose} type="button">
          ×
        </button>
      </div>
      <div className="strip">
        <StatTile label="Real power" value={formatPower(base.power)} />
        <StatTile label="HQ" value={base.hq === null ? '—' : String(base.hq)} />
        <StatTile
          label="Shield"
          note={
            shielded && base.shieldEnd !== null
              ? `until ${base.shieldEnd.toISOString().slice(11, 16)} UTC`
              : undefined
          }
          value={shielded ? 'Shielded' : 'No shield'}
        />
      </div>
      <p className="subtle">
        {formatCoordinate(base.at)} · seen {formatAge(base.seenAt.toISOString(), now)}
        {isStale(base, now) && ' — may have moved, and the shield may have changed'}
      </p>
      <button className="atlas-detail__copy" onClick={() => onCopy(base)} type="button">
        Copy {formatCopyCoordinate(base.at)}
      </button>
      {copied && <output className="subtle">Copied {copied}</output>}
      {mates.length > 0 && (
        <>
          <h3 className="atlas-detail__title">Strongest in [{alliance?.code ?? '?'}]</h3>
          <ol className="map-results atlas-strongest">
            {mates.map((mate) => (
              <BaseRow base={mate} key={mate.gameUid} on={false} onChoose={onChoose} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
