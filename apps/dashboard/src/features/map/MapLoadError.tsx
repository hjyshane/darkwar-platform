import { useT } from '../../lib/i18n';
import { loadErrorText } from './loadError';

interface MapLoadErrorProps {
  error: unknown;
  /** Runs the query again without reloading the page; the sentence still
   * says "refresh" because that is what a reader does when a button fails. */
  onRetry?: () => void;
}

/** The map's error state: one sentence that says what to do, a button that
 * does it, and the database's words only when they are not the timeout. */
export function MapLoadError({ error, onRetry }: MapLoadErrorProps) {
  const t = useT();
  const { message, detail } = loadErrorText(error, t);
  return (
    <p className="error" role="alert">
      {message}
      {onRetry ? (
        <>
          {' '}
          <button className="link-button" onClick={onRetry} type="button">
            {t('Try again')}
          </button>
        </>
      ) : null}
      {detail ? <small> ({detail})</small> : null}
    </p>
  );
}
