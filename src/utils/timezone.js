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
