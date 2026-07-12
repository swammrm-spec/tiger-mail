export const JORDAN_TIMEZONE = "Asia/Amman";

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getJordanFormatter(options = {}) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JORDAN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...options
  });
}

function getJordanParts(value) {
  const date = normalizeDateValue(value);
  if (!date) {
    return null;
  }
  const parts = getJordanFormatter().formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return {
    year: Number(values.year || 0),
    month: Number(values.month || 0),
    day: Number(values.day || 0),
    hour: Number(values.hour || 0),
    minute: Number(values.minute || 0),
    second: Number(values.second || 0)
  };
}

export function formatJordanDateTime(value, options = {}, locale = "en-GB") {
  const date = normalizeDateValue(value);
  if (!date) {
    return "-";
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: JORDAN_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options
  });
  return formatter.format(date);
}

export function formatJordanDateOnly(value, options = {}, locale = "en-GB") {
  return formatJordanDateTime(value, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: undefined,
    minute: undefined,
    ...options
  }, locale);
}

export function getJordanDateKey(value) {
  const date = normalizeDateValue(value);
  if (!date) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: JORDAN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

export function getJordanNowDateKey() {
  return getJordanDateKey(new Date());
}

export function formatJordanDateTimeInput(value) {
  const parts = getJordanParts(value);
  if (!parts) {
    return "";
  }
  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  const hh = String(parts.hour).padStart(2, "0");
  const min = String(parts.minute).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function getJordanNowDateTimeInput() {
  return formatJordanDateTimeInput(new Date());
}

export function parseJordanDateTimeInputToISOString(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0
  );
  const jordanGuessParts = getJordanParts(new Date(utcGuess));
  if (!jordanGuessParts) {
    return null;
  }
  const zonedUtc = Date.UTC(
    jordanGuessParts.year,
    jordanGuessParts.month - 1,
    jordanGuessParts.day,
    jordanGuessParts.hour,
    jordanGuessParts.minute,
    jordanGuessParts.second,
    0
  );
  const offset = zonedUtc - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

export function parseJordanDateOnlyToISOString(value, endOfDay = false) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  return parseJordanDateTimeInputToISOString(`${normalized}T${endOfDay ? "23:59:59" : "00:00:00"}`);
}
