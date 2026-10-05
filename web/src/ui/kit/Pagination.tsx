import { ChevronLeft, ChevronRight } from "lucide-react";

import { m } from "../../paraglide/messages";
import { Icon } from "./Icon";

/*
 * Small page buttons at the foot of a list: the step back, the first and
 * last pages, the pages around the current one with a gap where pages are
 * left out, and the step forward. The current page is outlined in the
 * primary color. Renders nothing while everything fits on one page.
 */
export function Pagination({
  current,
  pageSize,
  total,
  onChange,
}: {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last === 1) return null;
  return (
    <nav aria-label={m.ui_pagination()} className="ui-pagination">
      <button
        aria-label={m.ui_pagination_previous()}
        className="ui-pagination-item"
        disabled={current <= 1}
        type="button"
        onClick={() => onChange(current - 1)}
      >
        <Icon icon={ChevronLeft} size={14} />
      </button>
      {pages(current, last).map((page) =>
        typeof page === "string" ? (
          <span aria-hidden className="ui-pagination-gap" key={page}>
            …
          </span>
        ) : (
          <button
            aria-current={page === current ? "page" : undefined}
            aria-label={m.ui_pagination_page({ page })}
            className="ui-pagination-item"
            key={page}
            type="button"
            onClick={() => onChange(page)}
          >
            {page}
          </button>
        ),
      )}
      <button
        aria-label={m.ui_pagination_next()}
        className="ui-pagination-item"
        disabled={current >= last}
        type="button"
        onClick={() => onChange(current + 1)}
      >
        <Icon icon={ChevronRight} size={14} />
      </button>
    </nav>
  );
}

/**
 * The pages to show: the ends, and two on each side of `current`. A run left
 * out is a string naming the page it follows.
 */
function pages(current: number, last: number): (number | string)[] {
  const shown = new Set([1, last]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page > 1 && page < last) shown.add(page);
  }
  const sorted = [...shown].sort((a, b) => a - b);
  return sorted.flatMap((page, index) => {
    const before = sorted[index - 1];
    return before !== undefined && page - before > 1
      ? [`after-${before}`, page]
      : [page];
  });
}
