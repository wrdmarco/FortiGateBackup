import cron from "node-cron";

type CronField = {
  values: number[];
  matches: Set<number>;
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

export function nextCronOccurrence(expression: string, from = new Date(), timeZone = "UTC") {
  const normalizedExpression = expression.trim();
  const fields = normalizedExpression.split(/\s+/);
  if (Number.isNaN(from.getTime())) throw new Error("Begindatum voor cronberekening is ongeldig.");
  assertTimeZone(timeZone);
  if (fields.length !== 5 || !cron.validate(normalizedExpression)) {
    throw new Error("Ongeldige cronexpressie. Gebruik vijf velden: minuut uur dag maand weekdag.");
  }

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12, MONTH_NAMES);
  const dayOfWeek = parseField(fields[4], 0, 7, WEEKDAY_NAMES, (value) => (value === 7 ? 0 : value));

  const currentWallClock = zonedDateParts(from, timeZone);
  const candidate = new Date(
    Date.UTC(
      currentWallClock.year,
      currentWallClock.month - 1,
      currentWallClock.day,
      currentWallClock.hour,
      currentWallClock.minute
    )
  );
  const lastYear = candidate.getUTCFullYear() + 8;

  while (candidate.getUTCFullYear() <= lastYear) {
    if (!month.matches.has(candidate.getUTCMonth() + 1)) {
      advanceToAllowedMonth(candidate, month.values);
      continue;
    }

    if (!dayOfMonth.matches.has(candidate.getUTCDate()) || !dayOfWeek.matches.has(candidate.getUTCDay())) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const nextHour = firstAtOrAfter(hour.values, candidate.getUTCHours());
    if (nextHour === undefined) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (nextHour !== candidate.getUTCHours()) {
      candidate.setUTCHours(nextHour, minute.values[0], 0, 0);
      continue;
    }

    const nextMinute = firstAtOrAfter(minute.values, candidate.getUTCMinutes());
    if (nextMinute === undefined) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, minute.values[0], 0, 0);
      continue;
    }
    if (nextMinute !== candidate.getUTCMinutes()) {
      candidate.setUTCMinutes(nextMinute, 0, 0);
      continue;
    }

    const instant = wallClockInstants(candidate, timeZone).find((value) => value.getTime() > from.getTime());
    if (instant) return instant;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
  }

  throw new Error("Cronexpressie heeft binnen acht jaar geen volgend uitvoermoment.");
}

export function nextZonedCalendarOccurrence(
  from: Date,
  interval: "daily" | "weekly" | "monthly",
  timeZone: string
) {
  if (Number.isNaN(from.getTime())) throw new Error("Begindatum voor schemaberekening is ongeldig.");
  assertTimeZone(timeZone);
  const wallClock = zonedDateParts(from, timeZone);
  const candidate = new Date(
    Date.UTC(
      wallClock.year,
      wallClock.month - 1,
      wallClock.day,
      wallClock.hour,
      wallClock.minute,
      wallClock.second,
      from.getUTCMilliseconds()
    )
  );
  if (interval === "daily") candidate.setUTCDate(candidate.getUTCDate() + 1);
  if (interval === "weekly") candidate.setUTCDate(candidate.getUTCDate() + 7);
  if (interval === "monthly") candidate.setUTCMonth(candidate.getUTCMonth() + 1);

  // During a spring-forward gap the requested wall-clock time does not exist.
  // Select the first valid minute after it instead of silently using server time.
  for (let minute = 0; minute <= 180; minute += 1) {
    const instant = wallClockInstants(candidate, timeZone).find((value) => value.getTime() > from.getTime());
    if (instant) return instant;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("Volgend uitvoermoment valt buiten het ondersteunde tijdzonebereik.");
}

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedDateParts(value: Date, timeZone: string): ZonedDateParts {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second
  };
}

function wallClockInstants(candidate: Date, timeZone: string) {
  const naiveTime = candidate.getTime();
  const sampleBase = Math.floor(naiveTime / 1000) * 1000;
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sampleTime = sampleBase + hours * 60 * 60 * 1000;
    const parts = zonedDateParts(new Date(sampleTime), timeZone);
    offsets.add(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - sampleTime
    );
  }

  const matches: Date[] = [];
  for (const offset of offsets) {
    const instant = new Date(naiveTime - offset);
    const projected = zonedDateParts(instant, timeZone);
    if (
      projected.year === candidate.getUTCFullYear() &&
      projected.month === candidate.getUTCMonth() + 1 &&
      projected.day === candidate.getUTCDate() &&
      projected.hour === candidate.getUTCHours() &&
      projected.minute === candidate.getUTCMinutes() &&
      projected.second === candidate.getUTCSeconds()
    ) {
      matches.push(instant);
    }
  }
  return matches
    .filter((value, index, values) => values.findIndex((other) => other.getTime() === value.getTime()) === index)
    .sort((left, right) => left.getTime() - right.getTime());
}

function assertTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
  } catch (error) {
    throw new Error(`Ongeldige IANA-tijdzone '${timeZone}'.`, { cause: error });
  }
}

function parseField(
  source: string,
  minimum: number,
  maximum: number,
  names: Record<string, number> = {},
  normalize: (value: number) => number = (value) => value
): CronField {
  const normalizedSource = replaceNames(source.toLowerCase(), names);
  const values = new Set<number>();

  for (const part of normalizedSource.split(",")) {
    const stepParts = part.split("/");
    if (stepParts.length > 2) throw new Error(`Ongeldige cronstap in '${source}'.`);
    const [rangeSource, stepSource] = stepParts;
    const step = stepSource === undefined ? 1 : Number(stepSource);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Ongeldige cronstap in '${source}'.`);

    let start = minimum;
    let end = maximum;
    if (rangeSource !== "*") {
      const range = rangeSource.split("-").map(Number);
      if (range.length === 1) {
        start = range[0];
        end = stepSource === undefined ? range[0] : maximum;
      } else if (range.length === 2) {
        [start, end] = range;
      } else {
        throw new Error(`Ongeldig cronbereik in '${source}'.`);
      }
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < minimum || end > maximum || start > end) {
      throw new Error(`Cronwaarde buiten bereik in '${source}'.`);
    }
    for (let value = start; value <= end; value += step) values.add(normalize(value));
  }

  const sorted = Array.from(values).sort((left, right) => left - right);
  if (!sorted.length) throw new Error(`Cronveld '${source}' bevat geen uitvoerbare waarden.`);
  return { values: sorted, matches: new Set(sorted) };
}

function replaceNames(source: string, names: Record<string, number>) {
  return Object.entries(names)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((value, [name, replacement]) => value.replace(new RegExp(name, "g"), String(replacement)), source);
}

function firstAtOrAfter(values: number[], current: number) {
  return values.find((value) => value >= current);
}

function advanceToAllowedMonth(candidate: Date, months: number[]) {
  const currentMonth = candidate.getUTCMonth() + 1;
  const nextMonth = months.find((month) => month > currentMonth);
  if (nextMonth !== undefined) {
    candidate.setUTCMonth(nextMonth - 1, 1);
  } else {
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1, months[0] - 1, 1);
  }
  candidate.setUTCHours(0, 0, 0, 0);
}
