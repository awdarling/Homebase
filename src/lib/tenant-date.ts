// Tenant-timezone date helpers.
//
// Why this file exists: `todayInTimezone` (start-of-day, "what calendar
// date is it for this company right now") is currently copy-pasted across
// several files in this repo (OPEN_ITEMS #7 / DRIFT_REGISTER note "the six
// remaining per-file todayInTimezone copies" as a separate, already-tracked
// W-3 cleanup item). This module does NOT attempt that consolidation —
// doing so here would grow the blast radius of a build whose whole point is
// "don't stop the system from working by accident."
//
// What this module DOES add is something that has never existed anywhere in
// either repo: an END-of-day boundary in a company's own timezone. Aegis
// already has an equivalent canonical `src/lib/tenant-date.ts` (with
// `todayInTimezone`/`tenantToday`/`addDays`, per its own CLAUDE.md hard
// rule) — this file mirrors that module's conventions for Homebase, which
// has no equivalent today, and is what the BILL-1/OPS-1 gate's grace-period
// boundary and the Quria admin UI need.
//
// No date library dependency: this follows the same native
// `Intl.DateTimeFormat` approach Aegis's tenant-date.ts already uses,
// rather than introducing date-fns-tz or similar.

export const DEFAULT_TENANT_TIMEZONE = 'America/New_York';

/** Today's calendar date (YYYY-MM-DD) as seen in the given IANA timezone. */
export function todayInTimezone(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TENANT_TIMEZONE }).format(now);
  }
}

// Plain-string date arithmetic on YYYY-MM-DD (UTC-noon anchor so DST can't
// shift the calendar day). Matches Aegis's src/lib/tenant-date.ts `addDays`.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes to ADD to local wall-clock time to get UTC, for `tz` at `instant`. */
function tzOffsetMinutesAt(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'), // some locales render midnight as 24
    get('minute'),
    get('second')
  );

  // Real UTC offsets are always whole minutes; rounding discards the
  // sub-minute noise introduced by comparing an instant that carries
  // milliseconds against a reconstruction that doesn't.
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The UTC instant corresponding to a given wall-clock date+time in an IANA
 * timezone. Two-pass offset resolution so the answer is correct even when
 * the naive first guess lands on the wrong side of a DST transition.
 */
function zonedTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string
): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  let utcMillis = Date.UTC(y, m - 1, d, hour, minute, second, ms);

  for (let i = 0; i < 2; i++) {
    const offsetMinutes = tzOffsetMinutesAt(tz, new Date(utcMillis));
    utcMillis = Date.UTC(y, m - 1, d, hour, minute, second, ms) - offsetMinutes * 60_000;
  }

  return new Date(utcMillis);
}

/**
 * The precise UTC instant of the LAST millisecond of `ymd` (YYYY-MM-DD), as
 * measured in the given IANA timezone. Falls back to DEFAULT_TENANT_TIMEZONE
 * on an invalid zone, matching this file's other functions.
 */
export function endOfDayInTimezone(ymd: string, tz: string): Date {
  try {
    return zonedTimeToUtc(ymd, 23, 59, 59, 999, tz);
  } catch {
    return zonedTimeToUtc(ymd, 23, 59, 59, 999, DEFAULT_TENANT_TIMEZONE);
  }
}

/**
 * The precise UTC instant of the FIRST millisecond of `ymd` (YYYY-MM-DD), as
 * measured in the given IANA timezone.
 */
export function startOfDayInTimezone(ymd: string, tz: string): Date {
  try {
    return zonedTimeToUtc(ymd, 0, 0, 0, 0, tz);
  } catch {
    return zonedTimeToUtc(ymd, 0, 0, 0, 0, DEFAULT_TENANT_TIMEZONE);
  }
}
