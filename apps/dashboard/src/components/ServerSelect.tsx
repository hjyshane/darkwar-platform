import { serverHash } from '../lib/route';
import type { ServerCount } from '../lib/serverFilter';
import { Select } from './ui/Select';

const ALL = 'all';

/** "All servers" plus one entry per server the screen has data for, as a
 * dropdown: the chip row stops fitting once the group passes a dozen servers.
 *
 * Same contract as ServerChips, so a screen can swap one for the other. */
export function ServerSelect({
  servers,
  value,
  onChange,
}: {
  servers: readonly ServerCount[];
  value: number | null;
  onChange: (server: number | null) => void;
}) {
  if (servers.length === 0) {
    return null;
  }
  const total = servers.reduce((sum, server) => sum + server.count, 0);
  return (
    <nav aria-label="Filter by server" className="server-links">
      <Select
        aria-label="Server"
        onChange={(next) => onChange(next === ALL ? null : Number(next))}
        value={value === null ? ALL : value}
      >
        <option value={ALL}>
          All servers ({servers.length}) · {total}
        </option>
        {servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.id} · {server.count}
          </option>
        ))}
      </Select>
      {value !== null && (
        <a className="server-link server-link-open" href={serverHash(value)}>
          Open server {value} →
        </a>
      )}
    </nav>
  );
}
