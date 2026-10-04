import type { ComponentProps, MouseEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { m } from "../../paraglide/messages";
import { Checkbox } from "./Checkbox";
import { cn } from "./cn";
import { Empty } from "./Empty";

/*
 * The table draws its own frame: one outlined surface whose corners clip the
 * header and the rows. In the card layout the frame goes away and each row is
 * its own outlined card.
 *
 * - Whole-row click: `TableRow`'s `clickable`. A click anywhere on the row
 *   that is not on a control is passed to the link in its `cellSlot="title"`
 *   cell, modifier keys included, so the link stays the row's one tab stop
 *   and a modified click opens a new tab as on the link itself.
 * - Selection: `TableSelectionHead` (select all, with the mixed state) and
 *   `TableSelectionCell` (one row) hold a checkbox each; a selected row is
 *   `data-state="selected"`. The caller owns the selected set.
 * - Groups: `TableGroupRow` heads the rows that follow it until the next
 *   group row; its own `TableSelectionCell` selects the group.
 * - `fill`: the table takes the height its flex parent leaves it and scrolls
 *   its rows under a pinned header.
 * - Pinned columns: `fixed="start"` / `"end"` on every cell of a column keeps
 *   it in view while the table scrolls sideways; a shadow marks the edge
 *   content is passing under.
 * - `TableEmpty` is the single row of an empty body.
 * - `narrow="cards"`: below 600px of table width each row becomes a card
 *   whose cells carry their `cellLabel` on the left; the default `"scroll"`
 *   scrolls horizontally when the table is wider than its box.
 */

interface TableProps extends Omit<
  ComponentProps<"table">,
  "className" | "style"
> {
  /** Takes the height its flex parent leaves it; the rows scroll under a pinned header. */
  fill?: boolean;
  footer?: ReactNode;
  narrow?: "scroll" | "cards";
}

export function Table({
  fill,
  footer,
  narrow = "scroll",
  ...props
}: TableProps) {
  const { contentRef, onScroll, shadow, tableRef } = useFixedColumns();
  return (
    <div
      className={cn(
        "ui-table-wrapper",
        narrow === "cards" && "ui-table-narrow-cards",
        fill && "ui-table-fill",
      )}
    >
      <div
        className={cn(
          "ui-table",
          fill && "ui-table-scroll-y",
          shadow.start && "ui-table-fix-start-shadow-show",
          shadow.end && "ui-table-fix-end-shadow-show",
        )}
      >
        <div className="ui-table-container">
          <div
            className="ui-table-content"
            ref={contentRef}
            onScroll={onScroll}
          >
            <table ref={tableRef} {...props} />
          </div>
        </div>
        {footer != null && <div className="ui-table-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Places pinned cells and tracks which edges have content scrolled under
 * them. A pinned cell sits after the widths of the pinned cells before it in
 * its row (after it, for `end`); offsets are re-measured after every render
 * and whenever the table resizes.
 */
function useFixedColumns() {
  const contentRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [shadow, setShadow] = useState({ start: false, end: false });

  const measureScroll = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const scrolled = Math.abs(content.scrollLeft);
    const start = scrolled > 0;
    const end = scrolled < content.scrollWidth - content.clientWidth - 1;
    setShadow((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  }, []);

  const place = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    for (const row of table.rows) {
      const cells = [...row.cells];
      let start = 0;
      for (const cell of cells) {
        if (!cell.classList.contains("ui-table-cell-fix-start")) continue;
        cell.style.insetInlineStart = `${start}px`;
        start += cell.getBoundingClientRect().width;
      }
      let end = 0;
      for (const cell of cells.reverse()) {
        if (!cell.classList.contains("ui-table-cell-fix-end")) continue;
        cell.style.insetInlineEnd = `${end}px`;
        end += cell.getBoundingClientRect().width;
      }
    }
    measureScroll();
  }, [measureScroll]);

  useLayoutEffect(place);

  useEffect(() => {
    const table = tableRef.current;
    const content = contentRef.current;
    if (!table || !content) return;
    const observer = new ResizeObserver(place);
    observer.observe(table);
    observer.observe(content);
    return () => observer.disconnect();
  }, [place]);

  return { contentRef, onScroll: measureScroll, shadow, tableRef };
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("ui-table-thead", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("ui-table-tbody", className)} {...props} />;
}

/** Things in a row that answer clicks themselves; a click on them is not a click on the row. */
const CONTROLS =
  "a, button, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [role='menuitem']";

/** Passes a click on the row to its title link, with the same button and modifier keys. */
function clickTitleLink(event: MouseEvent<HTMLTableRowElement>) {
  const row = event.currentTarget;
  const control = (event.target as Element).closest(CONTROLS);
  if (control !== null && row.contains(control)) return;
  // Dragging across a cell to copy its text is not a click on the row.
  if (window.getSelection()?.toString()) return;
  const link = row.querySelector<HTMLAnchorElement>(
    ':scope > [data-slot="title"] a[href]',
  );
  link?.dispatchEvent(
    new globalThis.MouseEvent(event.type, {
      altKey: event.altKey,
      bubbles: true,
      button: event.button,
      cancelable: true,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }),
  );
}

export function TableRow({
  className,
  clickable,
  ...props
}: ComponentProps<"tr"> & { clickable?: boolean }) {
  return (
    <tr
      className={cn("ui-table-row", className)}
      {...(clickable && {
        "data-clickable": "",
        onAuxClick: (event: MouseEvent<HTMLTableRowElement>) => {
          if (event.button === 1) clickTitleLink(event);
        },
        onClick: clickTitleLink,
      })}
      {...props}
    />
  );
}

/** Heads the rows after it up to the next group row. */
export function TableGroupRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn("ui-table-row ui-table-group-row", className)}
      {...props}
    />
  );
}

type Fixed = "start" | "end";

/** Classes of a cell pinned to one side of a horizontally scrolling table. */
function fixedClass(fixed: Fixed | undefined) {
  return fixed && ["ui-table-cell-fix", `ui-table-cell-fix-${fixed}`];
}

interface TableHeadProps extends ComponentProps<"th"> {
  fixed?: Fixed;
}

export function TableHead({ className, fixed, ...props }: TableHeadProps) {
  return (
    <th
      className={cn("ui-table-cell", fixedClass(fixed), className)}
      scope="col"
      {...props}
    />
  );
}

interface TableCellProps extends ComponentProps<"td"> {
  /** The label left of this cell in the card layout, usually the column header's text. */
  cellLabel?: string;
  /**
   * Where the cell goes in the card layout: `title` is the name heading the
   * card, `extra` sits beside it at the end (a row's menu).
   */
  cellSlot?: "title" | "extra";
  fixed?: Fixed;
}

export function TableCell({
  cellLabel,
  cellSlot,
  className,
  fixed,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn("ui-table-cell", fixedClass(fixed), className)}
      data-label={cellLabel}
      data-slot={cellSlot}
      {...props}
    />
  );
}

interface SelectionProps {
  checked: boolean;
  disabled?: boolean;
  fixed?: Fixed;
  /** Some but not all of what this box covers is selected. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
}

/** The header cell of the selection column: selects or clears every row. */
export function TableSelectionHead({
  checked,
  disabled,
  fixed,
  indeterminate,
  onChange,
}: SelectionProps) {
  return (
    <th
      className={cn(
        "ui-table-cell ui-table-selection-column",
        fixedClass(fixed),
      )}
      scope="col"
    >
      <Checkbox
        aria-label={m.ui_table_select_all()}
        checked={checked}
        disabled={disabled}
        indeterminate={indeterminate}
        onChange={onChange}
      />
    </th>
  );
}

/** The selection cell of a row or group row, named after it. */
export function TableSelectionCell({
  "aria-label": ariaLabel,
  checked,
  disabled,
  fixed,
  indeterminate,
  onChange,
}: SelectionProps & { "aria-label": string }) {
  return (
    <td
      className={cn(
        "ui-table-cell ui-table-selection-column",
        fixedClass(fixed),
      )}
    >
      <Checkbox
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        indeterminate={indeterminate}
        onChange={onChange}
      />
    </td>
  );
}

/*
 * A colspan past the last column ends at the last column, so the one cell of
 * an empty body spans every column without counting them; 1000 is the
 * largest colspan HTML allows.
 */
const ALL_COLUMNS = 1000;

/** The one row of an empty body, spanning every column. */
export function TableEmpty({ children }: { children?: ReactNode }) {
  return (
    <tr className="ui-table-placeholder">
      <td className="ui-table-cell" colSpan={ALL_COLUMNS}>
        {children ?? <Empty description={m.ui_no_data()} />}
      </td>
    </tr>
  );
}
