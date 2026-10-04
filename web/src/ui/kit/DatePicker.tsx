import { Field } from "@base-ui/react/field";
import { Popover as BasePopover } from "@base-ui/react/popover";
import {
  CalendarDate,
  endOfWeek,
  getLocalTimeZone,
  isSameDay,
  startOfMonth,
  startOfWeek,
  today,
} from "@internationalized/date";
import { CalendarIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { m } from "../../paraglide/messages";
import { getLocale } from "../../paraglide/runtime";
import { Button } from "./Button";
import { cn } from "./cn";
import { defaultPortalContainer } from "./floating";
import { Icon } from "./Icon";

/*
 * A controlled single-day picker that always holds a day. The field shows the
 * day formatted for the active locale; pressing it opens a dialog with three
 * panels: days of a month, months of a year, years of a decade. The header's
 * month and year buttons switch to the coarser panels; picking a year leads
 * to its months, picking a month to its days.
 *
 * Each panel is an ARIA grid with one tab stop. Arrows move by a cell (a
 * day, or a row of a week / three months / three years); PageUp and
 * PageDown move by a month (by a year with Shift) on the day panel and by a
 * year or a decade on the others; Home and End go to the start and end of
 * the row; Enter and Space pick. The grid follows the keyboard into
 * neighboring months.
 *
 * The trigger is the control of an enclosing Base UI Field: the field's
 * label names it, and the field's invalid state and errors apply to it.
 *
 * The field is outlined in the light scheme and filled in the dark one; CSS
 * picks it from `.dark`, so rendering never reads the theme. Today is read
 * only inside the open dialog, which renders only in the browser.
 */

export interface DatePickerProps {
  disabled?: boolean;
  /** The earliest day that can be picked. */
  minDate?: CalendarDate;
  onChange: (date: CalendarDate) => void;
  value: CalendarDate;
}

type Mode = "date" | "month" | "year";

const FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeZone: "UTC",
};

export function DatePicker({
  disabled = false,
  minDate,
  onChange,
  value,
}: DatePickerProps) {
  const locale = getLocale();
  const [open, setOpenState] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setOpen = (next: boolean) => {
    if (disabled && next) return;
    setOpenState(next);
  };
  const isDisabled = (date: CalendarDate) =>
    minDate !== undefined && date.compare(minDate) < 0;
  // Formatted in UTC so the runtime's time zone cannot move the day.
  const text = new Intl.DateTimeFormat(locale, FORMAT).format(
    value.toDate("UTC"),
  );
  const openFromField = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    triggerRef.current?.focus();
    setOpen(true);
  };

  return (
    <BasePopover.Root onOpenChange={setOpen} open={open}>
      <div
        className={cn(
          "ui-date-picker",
          "ui-date-picker-auto",
          disabled && "ui-date-picker-disabled",
        )}
        // A press on the padding or the suffix opens the dialog like a press on the text.
        onClick={openFromField}
        ref={setAnchor}
      >
        <div className="ui-date-picker-input" onClick={openFromField}>
          <BasePopover.Trigger
            className="ui-date-picker-trigger"
            disabled={disabled}
            ref={triggerRef}
            render={
              <Field.Control
                disabled={disabled}
                render={<button type="button" />}
                value={value.toString()}
              />
            }
          >
            {text}
          </BasePopover.Trigger>
          <span className="ui-date-picker-suffix">
            <Icon icon={CalendarIcon} />
          </span>
        </div>
      </div>
      <BasePopover.Portal container={defaultPortalContainer()}>
        <BasePopover.Positioner
          align="start"
          anchor={anchor}
          className="ui-date-picker-positioner"
          side="bottom"
          sideOffset={4}
        >
          <BasePopover.Popup
            aria-label={m.ui_date_picker_dialog()}
            className="ui-date-picker-dropdown"
            finalFocus={triggerRef}
            initialFocus={false}
          >
            <Panels
              isDisabled={isDisabled}
              locale={locale}
              onPick={(date) => {
                onChange(date);
                setOpen(false);
              }}
              value={value}
            />
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

function Panels({
  isDisabled,
  locale,
  onPick,
  value,
}: {
  isDisabled: (date: CalendarDate) => boolean;
  locale: string;
  onPick: (date: CalendarDate) => void;
  value: CalendarDate;
}) {
  const now = today(getLocalTimeZone());
  const [mode, setMode] = useState<Mode>("date");
  const [focused, setFocused] = useState(value);
  const focusedCell = useRef<HTMLTableCellElement>(null);
  // Focus follows the keyboard position after every move, and lands on it when the dialog opens.
  const focusPending = useRef(true);
  const labelId = useId();

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    focusedCell.current?.focus({ preventScroll: true });
  }, [focused, mode]);

  const moveTo = (date: CalendarDate) => {
    focusPending.current = true;
    setFocused(date);
  };
  const switchMode = (next: Mode) => {
    focusPending.current = true;
    setMode(next);
  };

  const yearFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    timeZone: "UTC",
  });
  const monthFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  });
  const yearLabel = yearFormat.format(focused.toDate("UTC"));
  const monthLabel = monthFormat.format(focused.toDate("UTC"));
  // Locales differ in whether the month or the year comes first.
  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
  }).formatToParts(new Date(Date.UTC(2000, 0, 15)));
  const monthFirst =
    parts.findIndex((part) => part.type === "month") <
    parts.findIndex((part) => part.type === "year");

  const decadeStart = Math.floor(focused.year / 10) * 10;
  const yearButton = (
    <button
      aria-label={m.ui_date_picker_choose_year()}
      className="ui-date-picker-year-btn"
      key="year"
      onClick={() => switchMode("year")}
      type="button"
    >
      {yearLabel}
    </button>
  );
  const monthButton = (
    <button
      aria-label={m.ui_date_picker_choose_month()}
      className="ui-date-picker-month-btn"
      key="month"
      onClick={() => switchMode("month")}
      type="button"
    >
      {monthLabel}
    </button>
  );

  const header =
    mode === "date" ? (
      <Header
        labelId={labelId}
        nextMonth={{
          label: m.ui_date_picker_next_month(),
          onClick: () => setFocused(focused.add({ months: 1 })),
        }}
        prevMonth={{
          label: m.ui_date_picker_prev_month(),
          onClick: () => setFocused(focused.subtract({ months: 1 })),
        }}
        nextYears={{
          label: m.ui_date_picker_next_year(),
          onClick: () => setFocused(focused.add({ years: 1 })),
        }}
        prevYears={{
          label: m.ui_date_picker_prev_year(),
          onClick: () => setFocused(focused.subtract({ years: 1 })),
        }}
      >
        {monthFirst ? [monthButton, yearButton] : [yearButton, monthButton]}
      </Header>
    ) : mode === "month" ? (
      <Header
        labelId={labelId}
        nextYears={{
          label: m.ui_date_picker_next_year(),
          onClick: () => setFocused(focused.add({ years: 1 })),
        }}
        prevYears={{
          label: m.ui_date_picker_prev_year(),
          onClick: () => setFocused(focused.subtract({ years: 1 })),
        }}
      >
        {yearButton}
      </Header>
    ) : (
      <Header
        labelId={labelId}
        nextYears={{
          label: m.ui_date_picker_next_decade(),
          onClick: () => setFocused(focused.add({ years: 10 })),
        }}
        prevYears={{
          label: m.ui_date_picker_prev_decade(),
          onClick: () => setFocused(focused.subtract({ years: 10 })),
        }}
      >
        <span className="ui-date-picker-decade-btn">
          {decadeStart}-{decadeStart + 9}
        </span>
      </Header>
    );

  return (
    <div className="ui-date-picker-panel-container">
      <div className="ui-date-picker-panel-layout">
        <div>
          <div className="ui-date-picker-panel">
            <div className={`ui-date-picker-${mode}-panel`}>
              {header}
              <div className="ui-date-picker-body">
                {mode === "date" ? (
                  <DateGrid
                    focused={focused}
                    focusedCell={focusedCell}
                    isDisabled={isDisabled}
                    labelId={labelId}
                    locale={locale}
                    moveTo={moveTo}
                    now={now}
                    onPick={onPick}
                    value={value}
                  />
                ) : mode === "month" ? (
                  <CoarseGrid
                    cells={Array.from({ length: 12 }, (_, index) =>
                      focused.set({ month: index + 1 }),
                    )}
                    columns={3}
                    focused={focused}
                    focusedCell={focusedCell}
                    format={(date) =>
                      monthFormat.format(date.set({ day: 1 }).toDate("UTC"))
                    }
                    inView={() => true}
                    isCurrent={(date) =>
                      date.year === now.year && date.month === now.month
                    }
                    isSelected={(date) =>
                      date.year === value.year && date.month === value.month
                    }
                    labelId={labelId}
                    moveTo={moveTo}
                    onPick={(date) => {
                      focusPending.current = true;
                      setFocused(date);
                      setMode("date");
                    }}
                    page={(date, direction) => date.add({ years: direction })}
                    step={(date, amount) => date.add({ months: amount })}
                  />
                ) : (
                  <CoarseGrid
                    cells={Array.from({ length: 12 }, (_, index) =>
                      focused.set({ year: decadeStart - 1 + index }),
                    )}
                    columns={3}
                    focused={focused}
                    focusedCell={focusedCell}
                    format={(date) =>
                      yearFormat.format(date.set({ day: 1 }).toDate("UTC"))
                    }
                    inView={(date) =>
                      date.year >= decadeStart && date.year <= decadeStart + 9
                    }
                    isCurrent={(date) => date.year === now.year}
                    isSelected={(date) => date.year === value.year}
                    labelId={labelId}
                    moveTo={moveTo}
                    onPick={(date) => {
                      focusPending.current = true;
                      setFocused(date);
                      setMode("month");
                    }}
                    page={(date, direction) =>
                      date.add({ years: 10 * direction })
                    }
                    step={(date, amount) => date.add({ years: amount })}
                  />
                )}
              </div>
            </div>
          </div>
          {mode === "date" && (
            <div className="ui-date-picker-footer">
              <Button
                className="ui-date-picker-today"
                disabled={isDisabled(now)}
                onClick={() => onPick(now)}
                size="small"
                type="text"
              >
                {m.ui_date_picker_today()}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface HeaderAction {
  label: string;
  onClick: () => void;
}

/**
 * Arrows on both sides of the panel title. The outer pair steps by years (one
 * on the day and month panels, ten on the year panel); the inner pair, on the
 * day panel only, steps by a month.
 */
function Header({
  children,
  labelId,
  nextMonth,
  nextYears,
  prevMonth,
  prevYears,
}: {
  children: ReactNode;
  labelId: string;
  nextMonth?: HeaderAction;
  nextYears: HeaderAction;
  prevMonth?: HeaderAction;
  prevYears: HeaderAction;
}) {
  return (
    <div className="ui-date-picker-header">
      <button
        aria-label={prevYears.label}
        className="ui-date-picker-header-prev-years-btn"
        onClick={prevYears.onClick}
        tabIndex={-1}
        type="button"
      >
        <span className="ui-date-picker-prev-years-icon" />
      </button>
      {prevMonth && (
        <button
          aria-label={prevMonth.label}
          className="ui-date-picker-header-prev-month-btn"
          onClick={prevMonth.onClick}
          tabIndex={-1}
          type="button"
        >
          <span className="ui-date-picker-prev-month-icon" />
        </button>
      )}
      <div
        aria-live="polite"
        className="ui-date-picker-header-view"
        id={labelId}
      >
        {children}
      </div>
      {nextMonth && (
        <button
          aria-label={nextMonth.label}
          className="ui-date-picker-header-next-month-btn"
          onClick={nextMonth.onClick}
          tabIndex={-1}
          type="button"
        >
          <span className="ui-date-picker-next-month-icon" />
        </button>
      )}
      <button
        aria-label={nextYears.label}
        className="ui-date-picker-header-next-years-btn"
        onClick={nextYears.onClick}
        tabIndex={-1}
        type="button"
      >
        <span className="ui-date-picker-next-years-icon" />
      </button>
    </div>
  );
}

function cellClass({
  disabled,
  inView,
  selected,
  current,
}: {
  current: boolean;
  disabled: boolean;
  inView: boolean;
  selected: boolean;
}) {
  return cn(
    "ui-date-picker-cell",
    inView && "ui-date-picker-cell-in-view",
    current && "ui-date-picker-cell-today",
    selected && "ui-date-picker-cell-selected",
    disabled && "ui-date-picker-cell-disabled",
  );
}

function DateGrid({
  focused,
  focusedCell,
  isDisabled,
  labelId,
  locale,
  moveTo,
  now,
  onPick,
  value,
}: {
  focused: CalendarDate;
  focusedCell: RefObject<HTMLTableCellElement | null>;
  isDisabled: (date: CalendarDate) => boolean;
  labelId: string;
  locale: string;
  moveTo: (date: CalendarDate) => void;
  now: CalendarDate;
  onPick: (date: CalendarDate) => void;
  value: CalendarDate;
}) {
  // Six weeks always, so the panel keeps its height from month to month.
  const first = startOfWeek(startOfMonth(focused), locale);
  const days = Array.from({ length: 42 }, (_, index) =>
    first.add({ days: index }),
  );
  const weeks = Array.from({ length: 6 }, (_, row) =>
    days.slice(row * 7, row * 7 + 7),
  );
  const weekdayFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const weekdayLongFormat = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
  const fullFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: "UTC",
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const shift = event.shiftKey;
    const moves: Record<string, () => CalendarDate> = {
      ArrowLeft: () => focused.subtract({ days: 1 }),
      ArrowRight: () => focused.add({ days: 1 }),
      ArrowUp: () => focused.subtract({ weeks: 1 }),
      ArrowDown: () => focused.add({ weeks: 1 }),
      PageUp: () =>
        shift
          ? focused.subtract({ years: 1 })
          : focused.subtract({ months: 1 }),
      PageDown: () =>
        shift ? focused.add({ years: 1 }) : focused.add({ months: 1 }),
      Home: () => startOfWeek(focused, locale),
      End: () => endOfWeek(focused, locale),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveTo(move());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isDisabled(focused)) onPick(focused);
    }
  };

  return (
    <table
      aria-labelledby={labelId}
      className="ui-date-picker-content"
      onKeyDown={onKeyDown}
      role="grid"
    >
      <thead>
        <tr>
          {weeks[0]!.map((day) => (
            <th
              abbr={weekdayLongFormat.format(day.toDate("UTC"))}
              key={day.toString()}
              scope="col"
            >
              {weekdayFormat.format(day.toDate("UTC"))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]!.toString()}>
            {week.map((day) => {
              const isFocused = isSameDay(day, focused);
              const disabled = isDisabled(day);
              const selected = isSameDay(day, value);
              const current = isSameDay(day, now);
              return (
                <td
                  aria-current={current ? "date" : undefined}
                  aria-disabled={disabled || undefined}
                  aria-label={fullFormat.format(day.toDate("UTC"))}
                  aria-selected={selected}
                  className={cellClass({
                    current,
                    disabled,
                    inView: day.month === focused.month,
                    selected,
                  })}
                  key={day.toString()}
                  onClick={() => {
                    if (disabled) return;
                    onPick(day);
                  }}
                  ref={isFocused ? focusedCell : undefined}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                >
                  <div className="ui-date-picker-cell-inner">{day.day}</div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoarseGrid({
  cells,
  columns,
  focused,
  focusedCell,
  format,
  inView,
  isCurrent,
  isSelected,
  labelId,
  moveTo,
  onPick,
  page,
  step,
}: {
  cells: CalendarDate[];
  columns: number;
  focused: CalendarDate;
  focusedCell: RefObject<HTMLTableCellElement | null>;
  format: (date: CalendarDate) => string;
  inView: (date: CalendarDate) => boolean;
  isCurrent: (date: CalendarDate) => boolean;
  isSelected: (date: CalendarDate) => boolean;
  labelId: string;
  moveTo: (date: CalendarDate) => void;
  onPick: (date: CalendarDate) => void;
  page: (date: CalendarDate, direction: 1 | -1) => CalendarDate;
  step: (date: CalendarDate, amount: number) => CalendarDate;
}) {
  const rows = Array.from({ length: cells.length / columns }, (_, row) =>
    cells.slice(row * columns, row * columns + columns),
  );
  const index = cells.findIndex((cell) => isSameDay(cell, focused));
  const column = index % columns;

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, () => CalendarDate> = {
      ArrowLeft: () => step(focused, -1),
      ArrowRight: () => step(focused, 1),
      ArrowUp: () => step(focused, -columns),
      ArrowDown: () => step(focused, columns),
      PageUp: () => page(focused, -1),
      PageDown: () => page(focused, 1),
      Home: () => step(focused, -column),
      End: () => step(focused, columns - 1 - column),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveTo(move());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(focused);
    }
  };

  return (
    <table
      aria-labelledby={labelId}
      className="ui-date-picker-content"
      onKeyDown={onKeyDown}
      role="grid"
    >
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]!.toString()}>
            {row.map((cell) => {
              const isFocused = isSameDay(cell, focused);
              const selected = isSelected(cell);
              return (
                <td
                  aria-selected={selected}
                  className={cellClass({
                    current: isCurrent(cell),
                    disabled: false,
                    inView: inView(cell),
                    selected,
                  })}
                  key={cell.toString()}
                  onClick={() => onPick(cell)}
                  ref={isFocused ? focusedCell : undefined}
                  role="gridcell"
                  tabIndex={isFocused ? 0 : -1}
                >
                  <div className="ui-date-picker-cell-inner">
                    {format(cell)}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
