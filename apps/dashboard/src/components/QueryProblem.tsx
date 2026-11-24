import { useT } from '../lib/i18n';

/** The line a card shows when its data did not load: what is missing, and a
 * way to ask again.
 *
 * A card that drew nothing on failure, or drew its empty sentence ("No
 * Alliance Duel theme today"), told the reader something false: that there
 * was nothing, when there was only no answer. This says which it was. */
export function QueryProblem({
  what,
  onRetry,
  retrying = false,
}: {
  /** Already translated: "the hive plan", "this week's events". */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const t = useT();
  return (
    <p className="error query-problem" role="alert">
      {t('Could not load {what}.', { what })}{' '}
      <button className="link-button" disabled={retrying} onClick={onRetry} type="button">
        {retrying ? t('Trying again…') : t('Try again')}
      </button>
    </p>
  );
}
