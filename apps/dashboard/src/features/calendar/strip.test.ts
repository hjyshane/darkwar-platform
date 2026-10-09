import { describe, expect, test } from 'vitest';
import type { CalendarEvent } from './data';
import { calendarStrip } from './strip';

const NOW = new Date('2026-10-10T12:00:00Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  server_id: 580,
  activity_id: '1',
  name: 'Event',
  category: 'event',
  activity_type: 1,
  starts_at: at(-24),
  ends_at: at(24),
  need_hq_level: null,
  sub_type: null,
  seen_at: at(-1),
  ...over,
});

const cell = (events: CalendarEvent[], label: string) =>
  calendarStrip(events, NOW).find((entry) => entry.label === label);

describe('calendarStrip', () => {
  test('counts what is running now, not a standing feature or an ended event', () => {
    const events = [
      event(),
      event({ activity_id: '2' }),
      event({ activity_id: '3', starts_at: at(-48), ends_at: at(-24) }),
      event({ activity_id: '4', starts_at: at(-24), ends_at: at(24 * 365 * 20) }),
    ];

    expect(cell(events, 'Running now')?.value).toBe('2');
  });

  test('names the running event that ends first, and how long it has left', () => {
    const events = [
      event({ activity_id: '1', name: 'Late', ends_at: at(48) }),
      event({ activity_id: '2', name: 'Soon', ends_at: at(5) }),
    ];

    expect(cell(events, 'Ends next')).toMatchObject({ value: 'Soon', note: 'in 5h 0m' });
  });

  test('names the event that starts next, and counts those announced ahead', () => {
    const events = [
      event({ activity_id: '1', name: 'Far', starts_at: at(100), ends_at: at(130) }),
      event({ activity_id: '2', name: 'Near', starts_at: at(10), ends_at: at(40) }),
    ];

    expect(cell(events, 'Starts next')?.value).toBe('Near');
    expect(cell(events, 'Announced ahead')?.value).toBe('2');
  });

  test('has no name to give when nothing is running or coming, and says zero rather than blank', () => {
    const only = [event({ starts_at: at(-48), ends_at: at(-24) })];

    expect(cell(only, 'Ends next')?.value).toBeNull();
    expect(cell(only, 'Starts next')?.value).toBeNull();
    expect(cell(only, 'Running now')?.value).toBe('0');
  });

  test('an unnamed event is shown by its id', () => {
    expect(cell([event({ name: null, activity_id: '55001' })], 'Ends next')?.value).toBe(
      'Event #55001',
    );
  });
});
