import { useState } from 'react';
import { TOUR_STEPS, markTourSeen, nextStep, tourSeen } from '../../lib/tour';

/** A short, dismissible walk through the frame, shown on a first visit.
 *
 * A card in the content flow rather than a spotlight overlay: it cannot cover
 * the thing it describes, cannot trap focus, and costs nothing when closed. */
export function Tour() {
  const [open, setOpen] = useState(() => !tourSeen());
  const [index, setIndex] = useState(0);
  if (!open) {
    return null;
  }
  const step = TOUR_STEPS[index];
  const next = nextStep(index);
  const close = () => {
    markTourSeen();
    setOpen(false);
  };
  return (
    <section aria-label="Welcome tour" className="tour">
      <p className="tour-count">
        {index + 1} of {TOUR_STEPS.length}
      </p>
      <h2 className="tour-title">{step?.title}</h2>
      <p>{step?.body}</p>
      <div className="tour-actions">
        <button onClick={() => (next === null ? close() : setIndex(next))} type="button">
          {next === null ? 'Done' : 'Next'}
        </button>
        {next !== null && (
          <button className="linklike" onClick={close} type="button">
            Skip
          </button>
        )}
      </div>
    </section>
  );
}
