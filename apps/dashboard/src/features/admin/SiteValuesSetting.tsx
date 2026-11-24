import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  type AnySiteSetting,
  type Choice,
  type FieldSpec,
  SITE_SETTINGS,
  isDefault,
  stableJson,
} from '../../lib/settings/registry';
import { useSaveSiteSetting, useStoredSiteSettings } from '../../lib/settings/useSiteSetting';
import { supabase } from '../../lib/supabase';
import { TRACKED_SERVERS_KEY } from '../../lib/trackedServers';

/** Settings › Shared › Site values: every entry of the settings registry, drawn
 * from its description, plus the server group. Nothing on this screen is
 * written per value by hand — a new registry entry appears here by itself. */
export function SiteValuesSetting() {
  const stored = useStoredSiteSettings();

  if (stored.isPending) return <p className="empty loading">Loading…</p>;
  if (stored.error) {
    return <p className="error">Could not load the settings: {stored.error.message}</p>;
  }

  return (
    <div className="site-values">
      <p className="note">
        Values that used to be written into the site's code. Each is the same for every alliance.
        Changes take effect for everybody within a few minutes; every change is kept in{' '}
        <a href="#/admin/operations/settings-history">Change history</a>, where it can be undone.
      </p>
      <ServerGroupCard />
      {SITE_SETTINGS.map((setting) => (
        <SettingCard
          key={setting.key}
          setting={setting}
          stored={stored.data.get(setting.key)?.value}
          storedAt={stored.data.get(setting.key)?.updatedAt ?? null}
        />
      ))}
    </div>
  );
}

function SettingCard({
  setting,
  stored,
  storedAt,
}: {
  setting: AnySiteSetting;
  stored: unknown;
  storedAt: string | null;
}) {
  const current = stored === undefined ? setting.defaultValue : setting.parse(stored);
  const [draft, setDraft] = useState<unknown>(current);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const save = useSaveSiteSetting();
  const currentJson = stableJson(current);

  // A save elsewhere (or this one landing) moves the stored value: start over from it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compared by content, not identity
  useEffect(() => setDraft(current), [currentJson]);

  const dirty = stableJson(draft) !== currentJson;
  const atDefault = stored === undefined;
  const commit = (value: unknown, done: string) =>
    save.mutate(
      { setting, value },
      {
        onSuccess: () => setMessage({ text: done, failed: false }),
        onError: (error) => setMessage({ text: `Could not save: ${error.message}`, failed: true }),
      },
    );

  return (
    <section aria-labelledby={`site-${setting.key}`} className="panel site-value">
      <header className="site-value-head">
        <h3 id={`site-${setting.key}`}>{setting.label}</h3>
        {atDefault ? (
          <span className="badge">Default</span>
        ) : (
          <span className="badge badge-fresh">
            Changed{storedAt === null ? '' : ` ${new Date(storedAt).toLocaleDateString()}`}
          </span>
        )}
      </header>
      <p className="subtle">
        {setting.help} Used on <a href={setting.usedOn.href}>{setting.usedOn.label}</a>.
      </p>
      <FieldEditor
        field={setting.field}
        id={setting.key}
        onChange={(next) => {
          setDraft(next);
          setMessage(null);
        }}
        value={draft}
      />
      <p className="site-value-actions">
        <button
          disabled={!dirty || save.isPending}
          onClick={() =>
            // Saving the default is the same as resetting: no row, so a later
            // change of the default in the code reaches this site too.
            isDefault(setting, setting.parse(draft))
              ? commit(null, 'Saved. This is the default again.')
              : commit(setting.parse(draft), 'Saved.')
          }
          type="button"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {dirty && (
          <button onClick={() => setDraft(current)} type="button">
            Discard changes
          </button>
        )}
        {!atDefault && (
          <button
            disabled={save.isPending}
            onClick={() => commit(null, 'Back to the default.')}
            type="button"
          >
            Reset to default
          </button>
        )}
      </p>
      {message !== null && (
        <p className={message.failed ? 'error' : 'note'} role={message.failed ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function FieldEditor({
  field,
  id,
  value,
  onChange,
}: {
  field: FieldSpec;
  id: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  switch (field.kind) {
    case 'number':
      return (
        <label htmlFor={`field-${id}`}>
          Value{field.unit === undefined ? '' : ` (${field.unit})`}{' '}
          <input
            id={`field-${id}`}
            max={field.max}
            min={field.min}
            onChange={(event) => onChange(event.target.valueAsNumber)}
            step={field.step}
            type="number"
            value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
          />
        </label>
      );
    case 'choices':
      return <ChoicesEditor onChange={onChange} options={field.options} value={value} />;
    case 'map':
      return (
        <MapEditor
          id={id}
          keyLabel={field.keyLabel}
          keyPattern={field.keyPattern}
          onChange={onChange}
          options={field.options}
          value={value}
        />
      );
  }
}

function ChoicesEditor({
  options,
  value,
  onChange,
}: {
  options: readonly Choice[];
  value: unknown;
  onChange: (next: string[]) => void;
}) {
  const picked = new Set(Array.isArray(value) ? (value as string[]) : []);
  return (
    <fieldset className="site-choices">
      <legend className="visually-hidden">Choices</legend>
      {options.map((option) => (
        <label key={option.value}>
          <input
            checked={picked.has(option.value)}
            onChange={(event) => {
              const next = new Set(picked);
              if (event.target.checked) next.add(option.value);
              else next.delete(option.value);
              onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
            }}
            type="checkbox"
          />{' '}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function MapEditor({
  id,
  keyLabel,
  keyPattern,
  options,
  value,
  onChange,
}: {
  id: string;
  keyLabel: string;
  keyPattern: RegExp;
  options: readonly Choice[];
  value: unknown;
  onChange: (next: Record<string, string>) => void;
}) {
  const map: Record<string, string> =
    typeof value === 'object' && value !== null ? { ...(value as Record<string, string>) } : {};
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState(options[0]?.value ?? '');
  const codes = Object.keys(map).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const newKeyOk = keyPattern.test(newKey) && !(newKey in map);

  return (
    <div className="site-map">
      <table>
        <thead>
          <tr>
            <th scope="col">{keyLabel}</th>
            <th scope="col">Filed under</th>
            <th scope="col">
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code}>
              <td className="num">{code}</td>
              <td>
                <select
                  aria-label={`${keyLabel} ${code}`}
                  onChange={(event) => onChange({ ...map, [code]: event.target.value })}
                  value={map[code]}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  aria-label={`Remove ${keyLabel.toLowerCase()} ${code}`}
                  onClick={() => {
                    const next = { ...map };
                    delete next[code];
                    onChange(next);
                  }}
                  type="button"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="site-map-add">
        <label htmlFor={`map-key-${id}`}>
          {keyLabel}{' '}
          <input
            id={`map-key-${id}`}
            inputMode="numeric"
            onChange={(event) => setNewKey(event.target.value.trim())}
            size={8}
            value={newKey}
          />
        </label>{' '}
        <label htmlFor={`map-value-${id}`}>
          filed under{' '}
          <select
            id={`map-value-${id}`}
            onChange={(event) => setNewValue(event.target.value)}
            value={newValue}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>{' '}
        <button
          disabled={!newKeyOk}
          onClick={() => {
            onChange({ ...map, [newKey]: newValue });
            setNewKey('');
          }}
          type="button"
        >
          Add
        </button>
        {newKey !== '' && newKey in map && <span className="subtle"> Already listed.</span>}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ server group

interface ServerRow {
  server_id: number;
  is_tracked: boolean;
}

/** The group the server pickers list (`servers.is_tracked`). Not an
 * app_settings value: it is a column of the servers table, which the map
 * coverage reads too, so it is changed through set_server_tracked (0347). */
function ServerGroupCard() {
  const client = useQueryClient();
  const servers = useQuery({
    queryKey: ['servers', 'all-for-settings'],
    queryFn: async (): Promise<ServerRow[]> => {
      const { data, error } = await supabase
        .from('servers')
        .select('server_id, is_tracked')
        .order('server_id');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [draft, setDraft] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [adding, setAdding] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const save = useMutation({
    mutationFn: async (changes: ReadonlyArray<[number, boolean]>) => {
      // One call per server, in order, so a refusal says which server.
      for (const [serverId, tracked] of changes) {
        const { error } = await supabase.rpc('set_server_tracked', {
          p_server_id: serverId,
          p_tracked: tracked,
        });
        if (error) {
          throw new Error(
            error.code === 'PGRST202'
              ? 'the database does not have this yet (migration 0347 is not applied)'
              : `server ${serverId}: ${error.message}`,
          );
        }
      }
    },
    onSuccess: () => {
      setDraft(new Map());
      setMessage({ text: 'Saved.', failed: false });
    },
    onError: (error: Error) =>
      setMessage({ text: `Could not save: ${error.message}`, failed: true }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['servers'] }),
        client.invalidateQueries({ queryKey: TRACKED_SERVERS_KEY }),
        client.invalidateQueries({ queryKey: ['settings-history'] }),
      ]);
    },
  });

  const rows = servers.data ?? [];
  const tracked = (row: ServerRow) => draft.get(row.server_id) ?? row.is_tracked;
  const known = new Set(rows.map((row) => row.server_id));
  const addId = Number(adding);
  const addOk = /^\d{1,4}$/.test(adding) && addId >= 1 && !known.has(addId) && !draft.has(addId);
  const changes = [...draft.entries()].filter(
    ([id, value]) => rows.find((row) => row.server_id === id)?.is_tracked !== value,
  );
  const inGroup = rows.filter(tracked).length + changes.filter(([id]) => !known.has(id)).length;

  return (
    <section aria-labelledby="site-server-group" className="panel site-value">
      <header className="site-value-head">
        <h3 id="site-server-group">Server group</h3>
        <span className="badge">{inGroup} servers</span>
      </header>
      <p className="subtle">
        The servers the migration screens and the Merchant tester list, and the ones the map
        coverage counts. A server the collector has met but that is not ours stays unticked.
      </p>
      {servers.isPending && <p className="empty loading">Loading…</p>}
      {servers.error && (
        <p className="error">Could not load the servers: {servers.error.message}</p>
      )}
      <fieldset className="site-choices site-servers">
        <legend className="visually-hidden">Tracked servers</legend>
        {[...rows.map((row) => row.server_id), ...[...draft.keys()].filter((id) => !known.has(id))]
          .sort((a, b) => a - b)
          .map((id) => {
            const row = rows.find((entry) => entry.server_id === id);
            const checked = row === undefined ? (draft.get(id) ?? true) : tracked(row);
            return (
              <label key={id}>
                <input
                  checked={checked}
                  onChange={(event) => {
                    const next = new Map(draft);
                    next.set(id, event.target.checked);
                    setDraft(next);
                    setMessage(null);
                  }}
                  type="checkbox"
                />{' '}
                {id}
              </label>
            );
          })}
      </fieldset>
      <p className="site-map-add">
        <label htmlFor="site-server-add">
          Add a server not seen yet{' '}
          <input
            id="site-server-add"
            inputMode="numeric"
            onChange={(event) => setAdding(event.target.value.trim())}
            size={6}
            value={adding}
          />
        </label>{' '}
        <button
          disabled={!addOk}
          onClick={() => {
            setDraft(new Map(draft).set(addId, true));
            setAdding('');
          }}
          type="button"
        >
          Add
        </button>
      </p>
      <p className="site-value-actions">
        <button
          disabled={changes.length === 0 || save.isPending}
          onClick={() => save.mutate(changes)}
          type="button"
        >
          {save.isPending ? 'Saving…' : `Save${changes.length > 0 ? ` (${changes.length})` : ''}`}
        </button>
        {draft.size > 0 && (
          <button onClick={() => setDraft(new Map())} type="button">
            Discard changes
          </button>
        )}
      </p>
      {message !== null && (
        <p className={message.failed ? 'error' : 'note'} role={message.failed ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
