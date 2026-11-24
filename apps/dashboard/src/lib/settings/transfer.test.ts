import { describe, expect, it } from 'vitest';
import {
  GAME_GUIDE_UPCOMING_TIMES,
  PACK_CATEGORY_BY_TYPE,
  RUBY_DOLLAR_RATE,
  SITE_SETTINGS,
} from './registry';
import { type SettingChange, buildExport, planImport } from './transfer';

const SERVERS = [
  { server_id: 580, is_tracked: true },
  { server_id: 581, is_tracked: true },
  { server_id: 629, is_tracked: false },
];

const stored = (entries: Record<string, unknown>) =>
  new Map(Object.entries(entries).map(([key, value]) => [key, { value }]));

const summary = (changes: SettingChange[]) =>
  changes.map((change) =>
    change.kind === 'server'
      ? `server ${change.serverId} ${change.tracked}`
      : `${change.setting.key} ${change.value === null ? 'default' : JSON.stringify(change.value)}`,
  );

describe('buildExport', () => {
  it('writes only what is set, and the tracked servers in order', () => {
    const file = buildExport(
      SITE_SETTINGS,
      stored({ 'site.ruby_dollar_rate': 0.01, 'not.in.registry': 1 }),
      [581, 580],
      new Date('2026-11-24T12:00:00Z'),
    );
    expect(file).toEqual({
      format: 'dw-site-values',
      version: 1,
      exportedAt: '2026-11-24T12:00:00.000Z',
      values: { 'site.ruby_dollar_rate': 0.01 },
      trackedServers: [580, 581],
    });
  });
});

describe('planImport', () => {
  it('finds nothing to change in a file exported from the same state', () => {
    const now = stored({ 'site.ruby_dollar_rate': 0.01 });
    const file = buildExport(SITE_SETTINGS, now, [580, 581], new Date());
    const result = planImport(JSON.stringify(file), SITE_SETTINGS, now, SERVERS);
    expect(result).toEqual({ ok: true, plan: { changes: [], unknownKeys: [], unreadable: [] } });
  });

  it('lists every change: a new value, one back to the default, a server in and out, a new server', () => {
    const now = stored({ 'site.ruby_dollar_rate': 0.01 });
    const text = JSON.stringify({
      format: 'dw-site-values',
      version: 1,
      exportedAt: '2026-11-24T00:00:00Z',
      values: { 'site.game_guide_upcoming_times': 6 },
      trackedServers: [580, 629, 700],
    });
    const result = planImport(text, SITE_SETTINGS, now, SERVERS);
    if (!result.ok) throw new Error(result.reason);
    expect(summary(result.plan.changes)).toEqual([
      // Left out of the file, so back to the default: the file is the whole picture.
      `${RUBY_DOLLAR_RATE.key} default`,
      `${GAME_GUIDE_UPCOMING_TIMES.key} 6`,
      'server 581 false',
      'server 629 true',
      'server 700 true',
    ]);
  });

  it('stores a value equal to the default as no row at all', () => {
    const now = stored({ 'site.ruby_dollar_rate': 0.01 });
    const text = JSON.stringify({
      format: 'dw-site-values',
      version: 1,
      values: { 'site.ruby_dollar_rate': RUBY_DOLLAR_RATE.defaultValue },
    });
    const result = planImport(text, SITE_SETTINGS, now, SERVERS);
    if (!result.ok) throw new Error(result.reason);
    expect(summary(result.plan.changes)).toEqual([`${RUBY_DOLLAR_RATE.key} default`]);
  });

  it('skips and reports a key it does not know and a value it cannot read, writing neither', () => {
    const text = JSON.stringify({
      format: 'dw-site-values',
      version: 1,
      values: {
        'site.someday': 1,
        'site.ruby_dollar_rate': 50,
        'site.pack_category_by_type': { '26': 'daily', '27': 'not-a-category' },
      },
    });
    const result = planImport(text, SITE_SETTINGS, stored({}), SERVERS);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.unknownKeys).toEqual(['site.someday']);
    expect(result.plan.unreadable).toEqual([RUBY_DOLLAR_RATE.key, PACK_CATEGORY_BY_TYPE.key]);
    expect(result.plan.changes).toEqual([]);
  });

  it('leaves the server group alone when the file has none', () => {
    const text = JSON.stringify({ format: 'dw-site-values', version: 1, values: {} });
    const result = planImport(text, SITE_SETTINGS, stored({}), SERVERS);
    expect(result.ok && result.plan.changes).toEqual([]);
  });

  it('refuses a file that is not an export, rather than reading it as one', () => {
    expect(planImport('{', SITE_SETTINGS, stored({}), SERVERS)).toEqual({
      ok: false,
      reason: 'The file is not JSON.',
    });
    expect(planImport('{"values":{}}', SITE_SETTINGS, stored({}), SERVERS).ok).toBe(false);
    expect(
      planImport('{"format":"dw-site-values","version":2}', SITE_SETTINGS, stored({}), SERVERS),
    ).toEqual({ ok: false, reason: 'The file is version 2; this site reads 1.' });
  });
});
