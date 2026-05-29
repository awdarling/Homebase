/**
 * Parse a YYYY-MM-DD date string as a local-time Date (NOT UTC).
 * Use this for any date that came from a Postgres `date` column or
 * was rendered as a string elsewhere. Never use `new Date(dateStr)`
 * for these — it parses as UTC midnight, which shifts US timezones
 * back by one day. See Doc 5 §6.1.
 */
export function parseYMD(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Serialize a Date to YYYY-MM-DD using LOCAL year/month/day.
 * Never use Date.toISOString().split('T')[0] for this — that returns
 * UTC and shifts US timezones forward by one day for evening times.
 */
export function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Format a YYYY-MM-DD date string as a display label.
 * Locale-safe and timezone-safe.
 */
export function formatYMD(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  return parseYMD(dateStr).toLocaleDateString('en-US', options)
}
