import { serverHash } from '../lib/route';
import type { ServerCount } from '../lib/serverFilter';

/** "All servers" plus one chip per server the screen has data for.
 *
 * Buttons, not links: they change what this screen shows. The way out to a
 * server's own page is the link that appears once one is chosen. */
export function ServerChips({
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
      <button
        aria-pressed={value === null}
        className="server-link"
        onClick={() => onChange(null)}
        type="button"
      >
        All servers ({servers.length}) · {total}
      </button>
      {servers.map((server) => (
        <button
          aria-pressed={value === server.id}
          className="server-link"
          key={server.id}
          onClick={() => onChange(server.id)}
          type="button"
        >
          {server.id} · {server.count}
        </button>
      ))}
      {value !== null && (
        <a className="server-link server-link-open" href={serverHash(value)}>
          Open server {value} →
        </a>
      )}
    </nav>
  );
}
