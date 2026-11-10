// The guide row as the form holds it (0310): everything is text until Save.

import type { GuideInput } from '../guideData';
import { type GuideRow, parseStartsRule } from '../guides';

export interface GuideFormState {
  title: string;
  title_ko: string;
  slug: string;
  summary: string;
  summary_ko: string;
  published: boolean;
  /** An `event_guides.post_id` (a board post) or ''. */
  post_id: string;
  /** '1'..'7' or ''. */
  weekday: string;
  /** `HH:MM` server time, or ''. */
  time: string;
  servers: string;
  note: string;
}

export function formFromGuide(guide: GuideRow): GuideFormState {
  const rule = parseStartsRule(guide.starts_rule);
  return {
    title: guide.title,
    title_ko: guide.title_ko ?? '',
    slug: guide.slug,
    summary: guide.summary ?? '',
    summary_ko: guide.summary_ko ?? '',
    published: guide.published,
    post_id: guide.post_id ?? '',
    weekday: rule.weekday === undefined ? '' : String(rule.weekday),
    time: rule.time ?? '',
    servers: rule.servers ?? '',
    note: rule.note ?? '',
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

export type GuideFormResult = { ok: true; input: GuideInput } | { ok: false; reason: string };

/** What the table would accept, or the sentence that says what it would not.
 * The database checks the same things; this is so the person is told before
 * they press Save, not after the round trip. */
export function guideInputFrom(state: GuideFormState, guideId?: string): GuideFormResult {
  const title = state.title.trim();
  if (title === '') return { ok: false, reason: 'The guide needs a title.' };
  if (title.length > 120) return { ok: false, reason: 'The title is at most 120 characters.' };
  if (!SLUG.test(state.slug)) {
    return {
      ok: false,
      reason:
        'The address uses lower-case letters, digits and hyphens, starts with a letter or digit, and is at most 80 characters.',
    };
  }
  const weekday = state.weekday.trim();
  const time = state.time.trim();
  if ((weekday === '') !== (time === '')) {
    return { ok: false, reason: 'Set both the weekday and the time, or neither.' };
  }
  const rule: Record<string, unknown> = {};
  if (weekday !== '') {
    const day = Number(weekday);
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      return { ok: false, reason: 'The weekday is 1 (Monday) to 7 (Sunday).' };
    }
    if (!CLOCK.test(time))
      return { ok: false, reason: 'The time is a server-time clock, like 14:00.' };
    rule.weekday = day;
    rule.time = time;
  }
  const servers = orNull(state.servers);
  const note = orNull(state.note);
  if (servers !== null) rule.servers = servers;
  if (note !== null) rule.note = note;
  return {
    ok: true,
    input: {
      ...(guideId === undefined ? {} : { guide_id: guideId }),
      slug: state.slug,
      title,
      title_ko: orNull(state.title_ko),
      summary: orNull(state.summary),
      summary_ko: orNull(state.summary_ko),
      starts_rule: rule,
      published: state.published,
      post_id: state.post_id === '' ? null : state.post_id,
    },
  };
}
