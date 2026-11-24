// Vehicle chips in the planner (0311 steps, here since 2026-11-20).
//
// The login does not send chips, so unlike the vehicle and its parts a chip's
// state NOW is chosen by the reader, on every account. A vehicle carries more
// than one chip of a quality, so a quality can have several rows; each is its
// own target, `<quality>:<n>`, and all of a quality share one cost list.
//
// A row's "now" is kept here until it has a target; once it has one, the
// target's `from` is the record, which is what a saved plan brings back.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { useT } from '../../lib/i18n';
import { CHIP_MAX_LEVEL, chipLabel, chipSubjectName } from '../calculator/chips';
import { fetchCatalogSubjects } from './data';
import { type Target, targetKey } from './targets';

interface ChipPickerProps {
  targets: ReadonlyMap<string, Target>;
  onSet: (target: Target) => void;
}

/** The quality a chip target's subject names: "5" of "5:2". */
export function chipQuality(subject: string): string {
  return subject.split(':')[0] ?? subject;
}

/** How many rows a quality shows: the ones asked for, and never fewer than
 * the highest-numbered chip of it that has a target. */
export function chipRowCount(quality: string, asked: number, targets: Iterable<Target>): number {
  let count = Math.max(1, asked);
  for (const t of targets) {
    if (t.kind !== 'chip' || chipQuality(t.subject) !== quality) continue;
    count = Math.max(count, Number(t.subject.split(':')[1]) || 1);
  }
  return count;
}

function states(from: number, to: number): number[] {
  const out: number[] = [];
  for (let level = from; level <= to; level += 1) out.push(level);
  return out;
}

export function ChipPicker({ targets, onSet }: ChipPickerProps) {
  const t = useT();
  const catalog = useQuery({
    queryKey: ['planner-catalog', 'chip', 'maxima'],
    queryFn: async () =>
      new Map((await fetchCatalogSubjects('chip', {})).map((s) => [s.subject, s] as const)),
    staleTime: 60 * 60_000,
  });
  const [asked, setAsked] = useState<Record<string, number>>({});
  const [nows, setNows] = useState<Record<string, number>>({});

  if (catalog.isPending) return <p className="empty">{t('Loading chips…')}</p>;
  if (catalog.isError) return <p className="error">{catalog.error.message}</p>;
  const qualities = [...catalog.data.keys()].sort((a, b) => Number(a) - Number(b));
  if (qualities.length === 0) return null;

  return (
    <div className="table-wrap">
      <table className="compact planner-pick">
        <thead>
          <tr>
            <th className="label" scope="col">
              {t('Chip')}
            </th>
            <th scope="col">{t('Now')}</th>
            <th scope="col">{t('Target')}</th>
          </tr>
        </thead>
        <tbody>
          {qualities.flatMap((quality) => {
            const max = catalog.data.get(quality)?.maxLevel || CHIP_MAX_LEVEL;
            const count = chipRowCount(quality, asked[quality] ?? 1, targets.values());
            return states(1, count).map((n) => {
              const subject = `${quality}:${n}`;
              const name =
                n === 1 ? chipSubjectName(quality, t) : `${chipSubjectName(quality, t)} ${n}`;
              const target = targets.get(targetKey('chip', subject));
              const now = target?.from ?? nows[subject] ?? 0;
              const to = target?.to ?? now;
              const set = (from: number, wanted: number) =>
                onSet({ kind: 'chip', subject, name, from, to: Math.max(from, wanted) });
              return (
                <tr key={subject}>
                  <td className="label">
                    {name}
                    {n === count && (
                      <>
                        {' '}
                        <button
                          className="link"
                          onClick={() => setAsked({ ...asked, [quality]: count + 1 })}
                          title={t('Plan another {chip}', {
                            chip: chipSubjectName(quality, t).toLowerCase(),
                          })}
                          type="button"
                        >
                          {`+ ${t('another')}`}
                        </button>
                      </>
                    )}
                  </td>
                  <td>
                    <Select
                      aria-label={t('{label}: now', { label: name })}
                      onChange={(chosen) => {
                        const from = Number(chosen);
                        setNows({ ...nows, [subject]: from });
                        // Raising "now" to the target or past it drops the target.
                        if (target) set(from, to);
                      }}
                      value={now}
                    >
                      {states(0, max).map((level) => (
                        <option key={level} value={level}>
                          {chipLabel(level)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    {now >= max ? (
                      <span className="subtle level-max">{t('max')}</span>
                    ) : (
                      <Select
                        aria-label={t('{label}: target', { label: name })}
                        onChange={(chosen) => {
                          // The target is about to be the record of "now"; if it
                          // is cleared again, the row still remembers.
                          setNows({ ...nows, [subject]: now });
                          set(now, Number(chosen));
                        }}
                        value={to}
                      >
                        {states(now, max).map((level) => (
                          <option key={level} value={level}>
                            {level === now ? '—' : `→ ${chipLabel(level)}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      <p className="note">
        {t(
          'Chips are not in the login, so choose where each one stands now. EXP is counted in points and duplicates in chips; neither is held as stock.',
        )}
      </p>
    </div>
  );
}
