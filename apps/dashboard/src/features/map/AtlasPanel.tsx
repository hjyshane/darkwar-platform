import { formatCoordinate } from '@dw/ui';
import { StatTile } from '../../components/StatTile';
import { formatAge } from '../../lib/freshness';
import { useT } from '../../lib/i18n';
import {
  type Atlas,
  type AtlasBase,
  allianceColor,
  allianceSummary,
  byPower,
  formatCopyCoordinate,
  formatPower,
  homeServer,
  isShielded,
  isStale,
  shieldLeft,
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
  const t = useT();
  return (
    <li>
      <button
        className={on ? 'map-result--on atlas-base-row' : 'atlas-base-row'}
        onClick={() => onChoose(base)}
        type="button"
      >
        <span className="atlas-base-row__who">
          <strong>{base.name ?? t('unnamed')}</strong>
          <span className="subtle">
            {base.hq !== null && `${t('HQ {level}', { level: base.hq })} · `}
            {formatCopyCoordinate(base.at)}
            {base.shieldEnd !== null && isShielded(base, new Date()) && (
              <> · 🛡 {shieldLeft(base.shieldEnd, new Date())}</>
            )}
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
  const t = useT();
  const alliance = atlas.alliances[index];
  if (alliance === undefined) return null;
  const summary = allianceSummary(atlas, index, now);
  const color = allianceColor(alliance.id, isOurs);
  return (
    <section aria-label={t('Alliance')} className="atlas-detail">
      <div className="atlas-detail__bar">
        <button className="linklike" onClick={onBack} type="button">
          ‹ {t('All alliances')}
        </button>
        <button className="atlas-detail__action" onClick={onCentre} type="button">
          {t('Centre on the alliance')}
        </button>
      </div>
      <div className="atlas-detail__head" style={{ borderColor: color }}>
        <Badge color={color} text={alliance.code ?? '?'} />
        <div>
          <strong>[{alliance.code ?? '?'}]</strong>
          <span className="subtle">
            {alliance.name ?? ''}
            {isOurs && ` · ${t('your alliance')}`}
          </span>
        </div>
      </div>
      <div className="strip">
        <StatTile label={t('Bases')} value={plain.format(summary.bases)} />
        <StatTile label={t('Shielded')} value={plain.format(summary.shielded)} />
        <StatTile label={t('Real power')} value={formatPower(summary.realPower)} />
      </div>
      <p className="subtle">
        {t('{read} of {total} profiles read.', {
          read: summary.profilesRead,
          total: summary.bases,
        })}
      </p>
      <h3 className="atlas-detail__title">{t('Strongest here')}</h3>
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
  serverId,
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
  /** The server whose map this is, to tell a migrant from somebody born here. */
  serverId: number;
  onBack: () => void;
  onClose: () => void;
  onCopy: (base: AtlasBase) => void;
  onChoose: (base: AtlasBase) => void;
}) {
  const t = useT();
  const alliance = base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
  const color = allianceColor(alliance?.id ?? null, isOurs);
  const shielded = isShielded(base, now) && base.shieldEnd !== null;
  const home = homeServer(base.gameUid);
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
    <section aria-label={t('Base')} className="atlas-detail">
      <div className="atlas-detail__bar">
        <button className="linklike" onClick={onBack} type="button">
          {alliance?.code ? `‹ [${alliance.code}]` : `‹ ${t('All alliances')}`}
        </button>
      </div>
      <div className="atlas-detail__head" style={{ borderColor: color }}>
        <Badge color={color} text={base.name ?? '?'} />
        <div>
          <strong>{base.name ?? t('unnamed')}</strong>
          <span className="subtle">
            {alliance ? `[${alliance.code ?? '?'}] ${alliance.name ?? ''}` : t('No alliance seen')}
          </span>
        </div>
        <button
          aria-label={t('Close')}
          className="atlas-detail__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </div>
      <div className="strip">
        <StatTile label={t('Real power')} value={formatPower(base.power)} />
        <StatTile label={t('HQ')} value={base.hq === null ? '—' : String(base.hq)} />
        <StatTile
          label={t('Shield')}
          note={
            shielded && base.shieldEnd !== null
              ? t('until {time} UTC', {
                  time: base.shieldEnd.toISOString().slice(5, 16).replace('T', ' '),
                })
              : undefined
          }
          value={
            shielded && base.shieldEnd !== null
              ? `🛡 ${t('{time} left', { time: shieldLeft(base.shieldEnd, now) ?? '' })}`
              : t('No shield')
          }
        />
      </div>
      {home !== serverId && (
        <p className="subtle">
          {t('Started on server {home} — migrated to {server}.', { home, server: serverId })}
        </p>
      )}
      <p className="subtle">
        {formatCoordinate(base.at)} ·{' '}
        {t('seen {age}', { age: formatAge(base.seenAt.toISOString(), now, t) })}
        {isStale(base, now) && ` — ${t('may have moved, and the shield may have changed')}`}
      </p>
      <button className="atlas-detail__copy" onClick={() => onCopy(base)} type="button">
        {t('Copy coordinate')}
      </button>
      {copied && <output className="subtle">{t('Copied {text}', { text: copied })}</output>}
      {mates.length > 0 && (
        <>
          <h3 className="atlas-detail__title">
            {t('Strongest in [{code}]', { code: alliance?.code ?? '?' })}
          </h3>
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
