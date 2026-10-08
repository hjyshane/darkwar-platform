import { useQuery } from '@tanstack/react-query';
import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { num, power } from './format';
import {
  LEVEL_NAMES,
  type MigrationConfig,
  type MigrationQuotaServer,
  fetchMigrationConfig,
  fetchMigrationQuotas,
  intakeLeft,
  seatList,
} from './quota';

const STALE_TIME = 5 * 60_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

function Seats({ value }: { value: unknown }) {
  const seats = seatList(value);
  if (seats === null) return <span title="shape not recognised — see the raw snapshot">—</span>;
  if (seats.length === 0) return <span className="subtle">none</span>;
  return (
    <>
      {seats.map(([type, n], index) => (
        <span key={type}>
          {index > 0 && ' · '}
          <span className="subtle">{LEVEL_NAMES[type - 1] ?? `T${type}`}</span> {num(n)}
        </span>
      ))}
    </>
  );
}

function Rules({ config }: { config: MigrationConfig | null }) {
  const floors = config?.power_tier_floors ?? null;
  if (config === null || floors === null) {
    return <p className="empty">No migration rules captured yet — they arrive with a login.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption>
          The four levels, by migrate power (from the login config, {serverTime(config.captured_at)}{' '}
          server time)
        </caption>
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col" className="numeric">
              From migrate power
            </th>
            <th scope="col" className="numeric">
              Power brackets
            </th>
          </tr>
        </thead>
        <tbody>
          {floors.map((floor, index) => (
            <tr key={floor}>
              <th scope="row">{LEVEL_NAMES[index] ?? `Level ${index + 1}`}</th>
              <td className="numeric" title={num(floor)}>
                {power(floor)}
              </td>
              <td className="numeric">
                {(config.power_brackets?.[index] ?? [])
                  .filter((b) => b < 9_999_999_999)
                  .map(power)
                  .join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Offer({ rows }: { rows: MigrationQuotaServer[] }) {
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption>What each server is offering, newest reading</caption>
        <thead>
          <tr>
            <th scope="col">Server</th>
            <th scope="col" className="numeric">
              Taken / allowed
            </th>
            <th scope="col">Seats left by level</th>
            <th scope="col">Special</th>
            <th scope="col">Invite</th>
            <th scope="col" className="numeric">
              Power floors
            </th>
            <th scope="col" className="numeric">
              Ceiling
            </th>
            <th scope="col">Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const left = intakeLeft(s.total_count, s.use_count);
            return (
              <tr key={s.server_id}>
                <th scope="row">
                  <a href={serverHash(s.server_id)}>{s.server_id}</a>
                </th>
                <td className="numeric" title={left === null ? undefined : `${num(left)} left`}>
                  {num(s.use_count)} / {num(s.total_count)}
                </td>
                <td>
                  <Seats value={s.migrate_left} />
                </td>
                <td>
                  <Seats value={s.special_left} />
                </td>
                <td>
                  <Seats value={s.invite_left} />
                </td>
                <td className="numeric">
                  {s.power_low_limit === null ? '—' : s.power_low_limit.map(power).join(' · ')}
                </td>
                <td className="numeric" title={`special: ${power(s.special_power_limit)}`}>
                  {s.power_limit === null || s.power_limit === 0 ? '—' : power(s.power_limit)}
                </td>
                <td>{serverTime(s.captured_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MigrationQuotas() {
  const config = useQuery({
    queryKey: ['migration', 'config'],
    queryFn: fetchMigrationConfig,
    staleTime: STALE_TIME,
  });
  const quotas = useQuery({
    queryKey: ['migration', 'quotas'],
    queryFn: fetchMigrationQuotas,
    staleTime: STALE_TIME,
  });

  if (config.isPending || quotas.isPending) return <p className="empty loading">Loading…</p>;
  if (config.error) return <p className="error">{config.error.message}</p>;
  if (quotas.error) return <p className="error">{quotas.error.message}</p>;

  return (
    <>
      {quotas.data.length === 0 ? (
        <p className="empty">
          {config.data?.new_migrate_on === false
            ? `The game has not turned the new migration screen on (as of ${serverTime(config.data.captured_at)} server time). `
            : ''}
          Per-server seats appear here once the screen is open and someone looks at it with the
          collector running.
        </p>
      ) : (
        <Offer rows={quotas.data} />
      )}
      <Rules config={config.data} />
      <p className="note">
        The levels and their cutoffs are the client's own login config. The per-server figures are
        read from the screen's server list; their layout was inferred from the client before the
        screen existed, so a dash means the game sent something this page does not recognise yet.
      </p>
    </>
  );
}
