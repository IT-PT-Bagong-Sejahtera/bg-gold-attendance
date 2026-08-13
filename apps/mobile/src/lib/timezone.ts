export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function calendarDateInTimeZone(
  value: Date,
  timeZone: string,
): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return {
    year: numericPart(parts, "year"),
    month: numericPart(parts, "month"),
    day: numericPart(parts, "day"),
  };
}

export function calendarDateKey(value: CalendarDate) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(
    value.day,
  ).padStart(2, "0")}`;
}

export function instantDateKey(value: Date, timeZone: string) {
  return calendarDateKey(calendarDateInTimeZone(value, timeZone));
}

export function addCalendarDays(value: CalendarDate, count: number) {
  return fromUTCDate(
    new Date(Date.UTC(value.year, value.month - 1, value.day + count, 12)),
  );
}

export function addCalendarMonths(value: CalendarDate, count: number) {
  const first = new Date(Date.UTC(value.year, value.month - 1 + count, 1, 12));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth() + 1;
  return {
    year,
    month,
    day: Math.min(value.day, daysInCalendarMonth({ year, month, day: 1 })),
  };
}

export function startOfCalendarWeek(value: CalendarDate) {
  const weekday = new Date(
    Date.UTC(value.year, value.month - 1, value.day, 12),
  ).getUTCDay();
  return addCalendarDays(value, -((weekday + 6) % 7));
}

export function startOfCalendarMonth(value: CalendarDate): CalendarDate {
  return { year: value.year, month: value.month, day: 1 };
}

export function daysInCalendarMonth(value: CalendarDate) {
  return new Date(Date.UTC(value.year, value.month, 0, 12)).getUTCDate();
}

export function sameCalendarDate(left: CalendarDate, right: CalendarDate) {
  return calendarDateKey(left) === calendarDateKey(right);
}

/** Convert an organization-local wall-clock time into its UTC instant. */
export function zonedDateTimeToUtc(
  value: CalendarDate,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const desired = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    hour,
    minute,
    second,
  );
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const representedAsUTC = Date.UTC(
      numericPart(parts, "year"),
      numericPart(parts, "month") - 1,
      numericPart(parts, "day"),
      numericPart(parts, "hour"),
      numericPart(parts, "minute"),
      numericPart(parts, "second"),
    );
    const next = desired - (representedAsUTC - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function formatCalendarDate(
  value: CalendarDate,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("id-ID", {
    ...options,
    timeZone: "UTC",
  }).format(
    new Date(Date.UTC(value.year, value.month - 1, value.day, 12)),
  );
}

export function formatInstant(
  value: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone }).format(
    value,
  );
}

function fromUTCDate(value: Date): CalendarDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: string) {
  const part = parts.find((candidate) => candidate.type === type)?.value;
  if (!part) throw new Error(`Bagian tanggal ${type} tidak tersedia.`);
  return Number(part);
}
