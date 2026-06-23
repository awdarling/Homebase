// Pillar 2 (document ingestion) — richer roster import.
//
// Today's import_employees inserts every extracted row verbatim, so re-running
// an import duplicates people, and role spellings like "lifeguard" vs the
// company's "Lifeguard" become distinct strings the engine can't match. This
// pure module normalizes an extracted roster before it's written: it
// canonicalizes role names against the company's defined roles, coerces the
// veteran flag, sanity-checks weekly hours, and DE-DUPES against the existing
// team (and within the batch). Pure → unit-tested under ts-node; the executor
// just inserts the rows it returns.

export interface RosterRowInput {
  name?: string
  primary_role?: string
  qualified_roles?: string[]
  contact_email?: string | null
  contact_phone?: string | null
  max_weekly_hours?: number
  is_veteran?: boolean | string | number
}

export interface RosterContext {
  existingEmployeeNames: string[]
  knownRoleNames: string[]
}

export interface NormalizedEmployee {
  name: string
  primary_role: string
  qualified_roles: string[]
  contact_email: string | null
  contact_phone: string | null
  max_weekly_hours: number
  is_veteran: boolean
}

export interface RosterImportPlan {
  toInsert: NormalizedEmployee[]
  warnings: string[]
  skipped: number
}

const lc = (s: string) => s.trim().toLowerCase()

const VETERAN_TRUE = new Set(['true', 'yes', 'y', '1', 'veteran', 'vet'])
function coerceVeteran(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'number') return v === 1
  if (typeof v === 'string') return VETERAN_TRUE.has(lc(v))
  return false
}

/** Match a role against the company's defined roles, returning the canonical
 *  spelling on an exact (case-insensitive) hit, or the trimmed input otherwise. */
function canonicalRole(input: string, knownByLc: Map<string, string>): { value: string; matched: boolean } {
  const trimmed = input.trim()
  if (!trimmed) return { value: '', matched: false }
  const hit = knownByLc.get(lc(trimmed))
  return hit ? { value: hit, matched: true } : { value: trimmed, matched: false }
}

export function planRosterImport(rows: RosterRowInput[], ctx: RosterContext): RosterImportPlan {
  const warnings: string[] = []
  const toInsert: NormalizedEmployee[] = []
  let skipped = 0

  const knownByLc = new Map<string, string>()
  for (const r of ctx.knownRoleNames ?? []) knownByLc.set(lc(r), r.trim())
  const hasKnownRoles = knownByLc.size > 0
  const existing = new Set((ctx.existingEmployeeNames ?? []).map(lc))
  const seen = new Set<string>()

  for (const row of rows ?? []) {
    const name = typeof row?.name === 'string' ? row.name.trim() : ''
    if (!name) { warnings.push('Skipped a row with no name.'); skipped++; continue }
    if (existing.has(lc(name))) { warnings.push(`"${name}" is already on the team — skipped.`); skipped++; continue }
    if (seen.has(lc(name))) { warnings.push(`"${name}" was listed twice — added once.`); skipped++; continue }
    seen.add(lc(name))

    const primaryRaw = typeof row.primary_role === 'string' ? row.primary_role : ''
    const primary = canonicalRole(primaryRaw, knownByLc)
    if (!primary.value) {
      warnings.push(`"${name}" has no role listed — added without a primary role; set it later.`)
    } else if (hasKnownRoles && !primary.matched) {
      warnings.push(`"${name}"'s role "${primary.value}" doesn't match a defined role — added as written; rename or add that role if needed.`)
    }

    let qualified: string[]
    if (Array.isArray(row.qualified_roles) && row.qualified_roles.length > 0) {
      const seenQ = new Set<string>()
      qualified = []
      for (const q of row.qualified_roles) {
        if (typeof q !== 'string' || !q.trim()) continue
        const canon = canonicalRole(q, knownByLc).value
        if (!seenQ.has(lc(canon))) { seenQ.add(lc(canon)); qualified.push(canon) }
      }
      if (qualified.length === 0 && primary.value) qualified = [primary.value]
    } else {
      qualified = primary.value ? [primary.value] : []
    }

    let hours = 40
    if (row.max_weekly_hours !== undefined && row.max_weekly_hours !== null) {
      const n = Number(row.max_weekly_hours)
      if (Number.isFinite(n) && n > 0) hours = n
      else warnings.push(`"${name}" had an invalid weekly-hours value — defaulted to 40.`)
    }

    const email = typeof row.contact_email === 'string' && row.contact_email.trim() ? row.contact_email.trim() : null
    const phone = typeof row.contact_phone === 'string' && row.contact_phone.trim() ? row.contact_phone.trim() : null

    toInsert.push({
      name,
      primary_role: primary.value,
      qualified_roles: qualified,
      contact_email: email,
      contact_phone: phone,
      max_weekly_hours: hours,
      is_veteran: coerceVeteran(row.is_veteran),
    })
  }

  return { toInsert, warnings, skipped }
}
