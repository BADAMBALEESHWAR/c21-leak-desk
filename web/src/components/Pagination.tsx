import { Icon } from './Icon';

/** Page buttons with first, last and neighbours of the current page; gaps shown as an ellipsis. */
export function Pagination({ page, pageCount, onPage, label }: { page: number; pageCount: number; onPage: (p: number) => void; label: string }) {
  if (pageCount <= 1) return null;
  const items: Array<number | 'gap'> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) items.push(p);
    else if (items[items.length - 1] !== 'gap') items.push('gap');
  }
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="pager-btn" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
        <Icon name="chevron-left" size={16} />
      </button>
      {items.map((it, i) =>
        it === 'gap' ? (
          <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            className={`pager-btn${it === page ? ' is-current' : ''}`}
            aria-current={it === page ? 'page' : undefined}
            aria-label={`Page ${it}`}
            onClick={() => onPage(it)}
          >
            {it}
          </button>
        ),
      )}
      <button type="button" className="pager-btn" onClick={() => onPage(page + 1)} disabled={page === pageCount} aria-label="Next page">
        <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  );
}
