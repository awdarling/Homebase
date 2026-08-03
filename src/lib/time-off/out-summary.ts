// "Who's Out this week" summarization.
//
// Turns a set of approved time-off requests into one row per employee that
// PRESERVES each distinct request (its dates, full/partial clock window, and
// reason) instead of flattening them into a single day-count + single reason.
// This is the data behind the Home dashboard's "Who's Out" card.
//
// Pure + self-contained (no React / DOM) so it can be unit-tested directly.

import type { PartialDayDetail } from '@/lib/types'

export interface TORequestLike {
  id: string
  status?: string
  employee?: { id?: string; name?: string; primary_role?: string } | null
  employee_id?: string
  start_date: string
  end_date: string
  reason?: string | null
  time_off_type?: 'full_day' | 'partial' | null
  partial_days?: PartialDayDetail[] | null
}

// One distinct time-off segment for an employee within the selected week:
// a date (or date range) that is either a full day or a partial window, with
// its own reason. Multiple of these are what the old single-reason row lost.
export interface OutSegment {
  dateLabel: string          // "Aug 5" or "Aug 6 – Aug 7"
  isPartial: boolean
  timeLabel: string | null   // "9:00 AM – 1:00 PM" (partial only; null for full day)
  reason: string
}

export interface OutRow {
  id: string
  name: string
  role: string
  days: number               // distinct calendar days off within the window
  span: string
  scope: 'full' | 'most' | 'partial' | 'one'
  scopeLabel: string
  reason: string             // the single-segment reason (used when segments.length === 1)
  segments: OutSegment[]     // itemized breakdown; length >= 1
  partialDays: number        // how many distinct days are partial-only
  summary: string            // compact one-line summary for the collapsed multi-segment row
}

// ── date helpers (local, pure) ────────────────────────────────────────────
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function enumerateISO(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const [ey, em, ed] = endISO.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  while (cur <= last) {
    out.push(toYMD(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function nextDayISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + 1)
  return toYMD(dt)
}

// ── partial-window formatting ─────────────────────────────────────────────
// "09:00" -> "9:00 AM". Returns null for unparseable/empty input.
export function fmtClock(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return null
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(Number.isNaN(m) ? 0 : m).padStart(2, '0')} ${ampm}`
}

// Exact clock window for a partial request. A single-day partial has one entry;
// multi-day partials with a uniform window collapse to that window; genuinely
// varying windows fall back to a plain "partial" note.
export function partialTimeLabel(days: PartialDayDetail[] | null | undefined): string | null {
  if (!days || days.length === 0) return null
  const fmtOne = (d: PartialDayDetail): string | null => {
    const s = fmtClock(d.start_time)
    const e = fmtClock(d.end_time)
    if (s && e) return `${s} – ${e}`
    if (d.shift_name) return `${d.shift_name} shift`
    return null
  }
  const first = fmtOne(days[0])
  const allSame = days.every((d) => fmtOne(d) === first)
  return allSame ? first : 'partial (varies by day)'
}

// ── segment de-dup + coalesce ─────────────────────────────────────────────
interface RawSeg {
  start: string
  end: string
  isPartial: boolean
  timeLabel: string | null
  reason: string
}

function segKey(s: RawSeg): string {
  return `${s.start}|${s.end}|${s.isPartial ? 'P' : 'F'}|${s.timeLabel ?? ''}|${s.reason}`
}

// Drop exact-duplicate requests (same dates + type + window + reason).
function dedupeSegs(segs: RawSeg[]): RawSeg[] {
  const seen = new Set<string>()
  const out: RawSeg[] = []
  for (const s of segs) {
    const k = segKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

// Merge adjacent segments that share reason + partial-ness + window and are
// date-contiguous, so two "personal" full days read as one "Aug 6 – Aug 7".
function coalesceSegs(segs: RawSeg[]): RawSeg[] {
  const sorted = [...segs].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  const out: RawSeg[] = []
  for (const s of sorted) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.reason === s.reason &&
      prev.isPartial === s.isPartial &&
      (prev.timeLabel ?? '') === (s.timeLabel ?? '') &&
      s.start <= nextDayISO(prev.end)
    ) {
      if (s.end > prev.end) prev.end = s.end
    } else {
      out.push({ ...s })
    }
  }
  return out
}

// Collapse an employee's approved time-off overlapping [rs, re] into one row,
// but PRESERVE each distinct request as its own segment. Distinct days still
// drive the extent label.
export function buildOutRows(reqs: TORequestLike[], rs: string, re: string): OutRow[] {
  const byEmp = new Map<string, { id: string; name: string; role: string; days: Set<string>; partialDays: Set<string>; segs: RawSeg[] }>()
  for (const r of reqs) {
    if (!(r.start_date <= re && r.end_date >= rs)) continue
    const key = r.employee?.id ?? r.employee_id ?? r.employee?.name ?? r.id
    let e = byEmp.get(key)
    if (!e) {
      e = { id: key, name: r.employee?.name ?? 'Unknown employee', role: r.employee?.primary_role ?? '—', days: new Set<string>(), partialDays: new Set<string>(), segs: [] }
      byEmp.set(key, e)
    }
    const s = r.start_date < rs ? rs : r.start_date
    const en = r.end_date > re ? re : r.end_date
    for (const iso of enumerateISO(s, en)) e.days.add(iso)

    const isPartial = r.time_off_type === 'partial' && !!r.partial_days && r.partial_days.length > 0
    if (isPartial) {
      // Only partial_days that fall inside the clamped window count as partial.
      for (const pd of r.partial_days!) {
        if (pd.date >= s && pd.date <= en) e.partialDays.add(pd.date)
      }
    }
    e.segs.push({
      start: s,
      end: en,
      isPartial,
      timeLabel: isPartial ? partialTimeLabel(r.partial_days) : null,
      reason: (r.reason ?? '').trim() || '—',
    })
  }

  return Array.from(byEmp.values()).map((e) => {
    const merged = coalesceSegs(dedupeSegs(e.segs))
    const segments: OutSegment[] = merged.map((seg) => ({
      dateLabel: seg.start === seg.end ? formatDate(seg.start) : `${formatDate(seg.start)} – ${formatDate(seg.end)}`,
      isPartial: seg.isPartial,
      timeLabel: seg.timeLabel,
      reason: seg.reason,
    }))

    const dayList = Array.from(e.days).sort()
    const n = dayList.length
    const span = n > 0 ? `${formatDate(dayList[0])}${n > 1 ? ` – ${formatDate(dayList[n - 1])}` : ''}` : ''
    const scope: OutRow['scope'] = n >= 7 ? 'full' : n >= 4 ? 'most' : n === 1 ? 'one' : 'partial'
    const scopeLabel = n >= 7 ? 'Full week' : n >= 4 ? 'Most of week' : n === 1 ? '1 day' : `${n} days`
    const partialDays = e.partialDays.size

    const summaryParts: string[] = [`${segments.length} request${segments.length === 1 ? '' : 's'}`]
    if (partialDays > 0) summaryParts.push(`${partialDays} partial`)
    const summary = summaryParts.join(' · ')

    return {
      id: e.id,
      name: e.name,
      role: e.role,
      days: n,
      span,
      scope,
      scopeLabel,
      reason: segments[0]?.reason ?? '—',
      segments,
      partialDays,
      summary,
    }
  }).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name))
}
