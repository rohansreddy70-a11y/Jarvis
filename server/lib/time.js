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
