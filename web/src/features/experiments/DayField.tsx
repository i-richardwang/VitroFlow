import type { CalendarDay } from "../../domain/experiments/schema";
import { DatePicker } from "../../ui/kit/DatePicker";
import { Form } from "../../ui/kit/Form";

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
}: {
  label: string;
  disabled: boolean;
  value: CalendarDay;
  onChange: (value: CalendarDay) => void;
  earliest?: { day: CalendarDay; error: string };
}) {
  return (
    <Form.Field
      label={label}
      // Days written YYYY-MM-DD sort as text in calendar order.
      validate={() =>
        earliest && value < earliest.day ? earliest.error : null
      }
      required
    >
      <DatePicker
        disabled={disabled}
        earliest={earliest?.day}
        value={value}
        onChange={onChange}
      />
    </Form.Field>
  );
}
