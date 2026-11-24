import { rich, useT } from '../../lib/i18n';
import { humanUntil, nextUp } from '../../lib/shellNav';
import { serverWhen } from '../calendar/data';
import { useCapturedTimes } from '../eventGuide/data';

const SHOWN = 5;

/** What the alliance has on next, from the times the game told the collector
 * (the siege, Frankie, Black Gold). Beside the figures rather than under them:
 * "when is the next thing" is the other question somebody arriving has.
 *
 * Gone when there is nothing to say. A card that says "nothing" on the front
 * page is furniture, and the times only exist once somebody from the alliance
 * has logged in on the collector. */
export function ComingUp() {
  const t = useT();
  const { data } = useCapturedTimes();
  const now = new Date();
  const ahead = (data ?? []).filter((entry) => Date.parse(entry.startsAt) > now.getTime());
  const first = nextUp(ahead, now);
  if (first === null) {
    return null;
  }
  return (
    <section aria-labelledby="coming-up-heading" className="panel">
      <h2 id="coming-up-heading">{t('Coming up')}</h2>
      <p className="panel-lead">
        {rich(t('{title} in {time}'), {
          title: first.title,
          time: <strong className="gold">{humanUntil(first.inMs, t)}</strong>,
        })}
        <span className="subtle"> · {serverWhen(ahead[0]?.startsAt ?? null)}</span>
      </p>
      {ahead.length > 1 && (
        <ul className="panel-list">
          {ahead.slice(1, SHOWN).map((entry) => (
            <li key={entry.id}>
              <span>{entry.title}</span>
              <span className="num">{serverWhen(entry.startsAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="subtle">
        {t('Server time (UTC−2).')} <a href="#/event-guide">{t('Game guide')}</a>
      </p>
    </section>
  );
}
