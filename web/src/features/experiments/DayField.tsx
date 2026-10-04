import {
  CalendarDate,
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

/** A required calendar day; it always holds one, so it cannot be cleared. */
export function DayField({
  label,
  disabled,
  value,
  onChange,
  minDate,
  className,
}: {
  label: string;
  disabled: boolean;
  value: CalendarDate;
  onChange: (value: CalendarDate) => void;
  minDate?: CalendarDate;
  className?: string;
}) {
  return (
    <Form.Field className={className} label={label} required>
      <DatePicker
        disabled={disabled}
        minDate={minDate}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
