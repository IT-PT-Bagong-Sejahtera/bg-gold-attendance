export type CalendarDate = { year: number; month: number; day: number };

export function calendarDateInTimeZone(value: Date, timeZone: string): CalendarDate {
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

export function addCalendarDays(value: CalendarDate, count: number): CalendarDate {
  const result = new Date(Date.UTC(value.year, value.month - 1, value.day + count, 12));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

export function startOfCalendarWeek(value: CalendarDate) {
  const weekday = new Date(Date.UTC(value.year, value.month - 1, value.day, 12)).getUTCDay();
  return addCalendarDays(value, -((weekday + 6) % 7));
}

export function calendarDateKey(value: CalendarDate) {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

export function instantDateKey(value: Date, timeZone: string) {
  return calendarDateKey(calendarDateInTimeZone(value, timeZone));
}

export function formatInstant(
  value: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone }).format(value);
}

export function formatCalendarDate(
  value: CalendarDate,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(value.year, value.month - 1, value.day, 12)),
  );
}

export function zonedDateTimeToUtc(
  value: CalendarDate,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const desired = Date.UTC(value.year, value.month - 1, value.day, hour, minute, second);
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

export function organizationLocalInputToUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  return zonedDateTimeToUtc(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) },
    timeZone,
    Number(match[4]),
    Number(match[5]),
  );
}

export function instantToOrganizationLocalInput(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return `${numericPart(parts, "year")}-${pad(numericPart(parts, "month"))}-${pad(
    numericPart(parts, "day"),
  )}T${pad(numericPart(parts, "hour"))}:${pad(numericPart(parts, "minute"))}`;
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: string) {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`Bagian tanggal ${type} tidak tersedia.`);
  return Number(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
