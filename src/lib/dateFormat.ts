const pad = (value: number) => String(value).padStart(2, '0');

export type DateParts = {
  year: number;
  month: number;
  day: number;
};

function isValidDateParts(parts: DateParts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
  );
}

export function formatDateParts(parts: DateParts) {
  return `${pad(parts.day)}-${pad(parts.month)}-${parts.year}`;
}

export function formatIsoDateParts(parts: DateParts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function parseDateParts(value: unknown): DateParts | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate()
    };
    return isValidDateParts(parts) ? parts : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date((value - 25569) * 86400 * 1000);
    const parts = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    };
    return isValidDateParts(parts) ? parts : null;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const parts = raw.split(/[-/.]/);
  if (parts.length === 3 && parts.every(Boolean)) {
    let year: number;
    let month: number;
    let day: number;

    if (parts[0].length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else {
      day = Number(parts[0]);
      month = Number(parts[1]);
      year = Number(parts[2]);
      if (year < 100) year += 2000;
    }

    const parsed = { year, month, day };
    return isValidDateParts(parsed) ? parsed : null;
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    const parsedParts = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    };
    return isValidDateParts(parsedParts) ? parsedParts : null;
  }

  return null;
}

export function normalizeDisplayDate(value: unknown) {
  const parts = parseDateParts(value);
  if (parts) return formatDateParts(parts);
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeIsoDate(value: unknown) {
  const parts = parseDateParts(value);
  if (parts) return formatIsoDateParts(parts);
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
