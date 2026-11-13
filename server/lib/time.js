// Time-zone aware helpers. All timestamps are stored as ISO-8601 UTC strings.
export const nowIso = () => new Date().toISOString();

export function formatInZone(date, timeZone, opts = {}) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    ...opts,
  }).format(date);
}

// Returns the [start, end) UTC instants of the local calendar day containing `date`.
export function localDayBounds(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = asUtc - Math.floor(date.getTime() / 1000) * 1000;
  const startLocalAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
  const start = new Date(startLocalAsUtc - offsetMs);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

export function parseFutureDate(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`"${value}" is not a valid date/time. Use ISO-8601, e.g. 2026-11-13T09:00:00Z.`);
  return d;
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

// Local calendar parts of an instant in a time zone.
export function localParts(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, minutes: +p.hour * 60 + +p.minute };
}

// Bounds of the local day `offsetDays` from the day containing `date` (0 = today, 1 = tomorrow).
export function dayBounds(date, timeZone, offsetDays = 0) {
  let { start, end } = localDayBounds(date, timeZone);
  for (let i = 0; i < offsetDays; i++) ({ start, end } = localDayBounds(new Date(end.getTime() + 12 * 3600e3), timeZone));
  return { start, end, dateKey: localParts(new Date(start.getTime() + 12 * 3600e3), timeZone).dateKey };
}

// Bounds of a local calendar date given as YYYY-MM-DD.
export function boundsForDateKey(dateKey, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new ValidationError('Date must be YYYY-MM-DD, "today" or "tomorrow".');
  const noonUtc = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(noonUtc.getTime())) throw new ValidationError(`"${dateKey}" is not a valid date.`);
  return { ...localDayBounds(noonUtc, timeZone), dateKey };
}

export function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}
