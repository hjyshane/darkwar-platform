import { pageNumbers } from '../lib/pagination';

/** << ‹ 1 2 3 › >>
 *
 * Buttons, not links: the page is component state rather than an address. A
 * numbered address per page would be nicer to share, but it also means a link
 * somebody sends goes stale the moment a post is added above the one they meant —
 * and the post's own address is the thing worth sharing anyway.
 *
 * The current page is `aria-current="page"` and disabled, so a screen reader says
 * which one it is and a click on it cannot refetch the same rows.
 */
export function Pager({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
}) {
  // One page needs no pager. Drawing a disabled "1" is furniture that says
  // nothing.
  if (pageCount <= 1) {
    return null;
  }
  const first = page === 1;
  const last = page === pageCount;
  return (
    <nav aria-label="Pages" className="pager">
      <button aria-label="First page" disabled={first} onClick={() => onGo(1)} type="button">
        «
      </button>
      <button
        aria-label="Previous page"
        disabled={first}
        onClick={() => onGo(page - 1)}
        type="button"
      >
        ‹
      </button>
      {pageNumbers(pageCount, page).map((number) => (
        <button
          key={number}
          aria-current={number === page ? 'page' : undefined}
          disabled={number === page}
          onClick={() => onGo(number)}
          type="button"
        >
          {number}
        </button>
      ))}
      <button aria-label="Next page" disabled={last} onClick={() => onGo(page + 1)} type="button">
        ›
      </button>
      <button aria-label="Last page" disabled={last} onClick={() => onGo(pageCount)} type="button">
        »
      </button>
    </nav>
  );
}
