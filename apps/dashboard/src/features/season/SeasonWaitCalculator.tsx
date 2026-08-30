import { useId, useState } from 'react';
import { formatWait, parseAmount, waitFor } from './wait';

/** How long until a resource reaches what an upgrade wants.
 *
 * The whole thing is local state. The app holds no production rate for
 * anybody and the building board carries levels rather than stockpiles, so
 * all three figures are read off the game by whoever is standing in front of
 * it. Nothing here queries, and nothing here is saved — reload and the boxes
 * are empty again. That is stated on the screen so nobody types their numbers
 * expecting the alliance to see them.
 */
export function SeasonWaitCalculator() {
  const [perHour, setPerHour] = useState('');
  const [current, setCurrent] = useState('');
  const [needed, setNeeded] = useState('');
  // Ids rather than nesting the input inside its label, matching the rest of
  // the app's forms.
  const rateId = useId();
  const currentId = useId();
  const neededId = useId();

  const parsed = {
    perHour: parseAmount(perHour),
    current: parseAmount(current),
    needed: parseAmount(needed),
  };
  const answer = waitFor(parsed);
  const shortfall =
    parsed.needed !== null && parsed.current !== null ? parsed.needed - parsed.current : null;

  return (
    <div>
      <div className="stack">
        <label htmlFor={rateId}>
          Output per hour
          {/* `inputMode` rather than `type="number"`: the figures are pasted
              off the game with its own separators, which a number input
              rejects outright, and the spinner arrows are useless here. */}
          <input
            autoComplete="off"
            id={rateId}
            inputMode="decimal"
            onChange={(event) => setPerHour(event.target.value)}
            placeholder="e.g. 1,200"
            value={perHour}
          />
        </label>
        <label htmlFor={currentId}>
          Current amount
          <input
            autoComplete="off"
            id={currentId}
            inputMode="decimal"
            onChange={(event) => setCurrent(event.target.value)}
            placeholder="e.g. 40,000"
            value={current}
          />
        </label>
        <label htmlFor={neededId}>
          Amount needed to upgrade
          <input
            autoComplete="off"
            id={neededId}
            inputMode="decimal"
            onChange={(event) => setNeeded(event.target.value)}
            placeholder="e.g. 100,000"
            value={needed}
          />
        </label>
      </div>

      {/* Polite, not assertive: the answer changes on every keystroke and an
          assertive region would interrupt a screen reader mid-number. */}
      <div aria-live="polite" className="stat">
        <div className="stat-label">Time to wait</div>
        <div className="stat-value">
          {answer === null && '—'}
          {answer?.kind === 'ready' && 'Ready now'}
          {answer?.kind === 'never' && 'Never at this rate'}
          {answer?.kind === 'wait' && formatWait(answer.hours)}
        </div>
      </div>

      <p className="note">
        {answer === null &&
          'Fill in all three boxes. A figure can be pasted with the separators the game draws.'}
        {answer?.kind === 'ready' && 'You already have enough for the upgrade.'}
        {answer?.kind === 'never' &&
          `Nothing is coming in, so the ${shortfall?.toLocaleString()} short never arrives. Check the output figure.`}
        {answer?.kind === 'wait' &&
          `${shortfall?.toLocaleString()} short at ${parsed.perHour?.toLocaleString()} an hour. Assumes the rate holds — a buff, a lost building or a full warehouse changes it.`}
      </p>
      <p className="note">
        Nothing typed here is sent anywhere or saved. It is arithmetic on your own screen, and the
        boxes empty on reload.
      </p>
    </div>
  );
}
