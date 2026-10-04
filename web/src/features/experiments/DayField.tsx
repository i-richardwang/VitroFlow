import {
  type CalendarDate,
  getLocalTimeZone,
  parseDate,
  today,
} from "@internationalized/date";

import type { CalendarDay } from "../../domain/experiments/schema";
import { DatePicker } from "../../ui/kit/DatePicker";
import { Form } from "../../ui/kit/Form";

export function toDay(value: CalendarDate): CalendarDay {
  return value.toString();
}

export function fromDay(day: CalendarDay): CalendarDate {
  return parseDate(day);
}

export function currentDay(): CalendarDate {
  return today(getLocalTimeZone());
}

/**
 * A required calendar day; it always holds one, so it cannot be cleared.
 * `earliest` greys the days before it in the calendar and rejects them on
 * submit, since the starting value can already lie before it.
 */
export function DayField({
  label,
  disabled,
  value,
  onChange,
  earliest,
  className,
}: {
  label: string;
  disabled: boolean;
  value: CalendarDate;
  onChange: (value: CalendarDate) => void;
  earliest?: { date: CalendarDate; error: string };
  className?: string;
}) {
  return (
    <Form.Field
      className={className}
      label={label}
      validate={() =>
        earliest && value.compare(earliest.date) < 0 ? earliest.error : null
      }
      required
    >
      <DatePicker
        disabled={disabled}
        minDate={earliest?.date}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
