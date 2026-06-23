// Pillar 2 (document ingestion): the pure, deterministic core that turns a
// configuration bundle Soteria extracts from a handbook / policy document into
// an ORDERED, VALIDATED, DE-DUPLICATED plan of writes.
//
// The risk in "configure Homebase from a document" is not the individual writes
// (those reuse the executor's proven, persistence-guarded inserts) — it's
// ordering and references: a shift's role requirement can't be created before
// the shift, a wage rate is meaningless without its role, a veteran rule needs
// a shift that exists. This module holds all of that logic so it can be unit-
// tested without a database. The executor (apply_setup_plan) just walks the
// returned steps and threads real IDs.
//
// v1 scope: profile, roles, wage rates, shift types + their role requirements,
// policies, veteran/experience rules. Employees and conflicts stay on the
// existing roster path (conflicts need employee IDs that only exist after
// import) — they're intentionally out of this bundle.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const HEX = /^#[0-9A-Fa-f]{6}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ProfileInput {
  business_type?: string
  description?: string
  operating_hours?: string
  peak_periods?: string
  manager_priorities?: string
  special_context?: string
}
export interface RoleInput {
  name: string
  color?: string
}
export interface WageRateInput {
  role: string
  hourly_rate: number
}
export interface RoleRequirementInput {
  accepted_roles: string[]
  required_count?: number
}
export interface ShiftTypeInput {
  name: string
  start_time: string
  end_time: string
  days_active: number[]
  role_requirements?: RoleRequirementInput[]
}
export interface PolicyInput {
  policy_key: string
  policy_value: string
  policy_value_json?: unknown
  policy_type?: string
  description?: string | null
}
export interface VeteranRuleInput {
  shift_name?: string | null
  days_of_week?: number[] | null
  role?: string | null
  mode: 'all_veterans' | 'min_veterans'
  min_count?: number | null
  season_start?: string | null
  season_end?: string | null
}

export interface ConfigBundle {
  profile?: ProfileInput
  roles?: RoleInput[]
  wage_rates?: WageRateInput[]
  shift_types?: ShiftTypeInput[]
  policies?: PolicyInput[]
  veteran_rules?: VeteranRuleInput[]
}

/** Current company config, used to skip duplicates and resolve references. */
export interface ExistingConfig {
  roleNames: string[]
  shiftTypeNames: string[]
  wageRoleNames: string[]
  policyKeys: string[]
}

export type PlannedStep =
  | { kind: 'profile'; data: ProfileInput }
  | { kind: 'role'; data: { name: string; color?: string } }
  | { kind: 'wage_rate'; data: { role: string; hourly_rate: number } }
  | {
      kind: 'shift_type'
      data: { name: string; start_time: string; end_time: string; days_active: number[] }
      requirements: { accepted_roles: string[]; required_count: number }[]
    }
  | { kind: 'policy'; data: PolicyInput }
  | {
      kind: 'veteran_rule'
      data: {
        shift_name: string | null
        days_of_week: number[] | null
        role: string | null
        mode: 'all_veterans' | 'min_veterans'
        min_count: number | null
        season_start: string | null
        season_end: string | null
      }
    }

export interface IngestionPlan {
  steps: PlannedStep[]
  warnings: string[]
  counts: {
    roles: number
    wage_rates: number
    shift_types: number
    role_requirements: number
    policies: number
    veteran_rules: number
    profile: number
  }
}

const lc = (s: string) => s.trim().toLowerCase()

/**
 * Build an ordered, validated plan from an extracted bundle.
 * Order: profile → roles → wage rates → shift types (+ their requirements) →
 * policies → veteran rules. Invalid or unresolved items become warnings, never
 * steps, so the executor only ever runs clean writes.
 */
export function planConfiguration(bundle: ConfigBundle, existing: ExistingConfig): IngestionPlan {
  const warnings: string[] = []
  const steps: PlannedStep[] = []

  const existingRoles = new Set(existing.roleNames.map(lc))
  const existingShiftTypes = new Set(existing.shiftTypeNames.map(lc))
  const existingWageRoles = new Set(existing.wageRoleNames.map(lc))
  const existingPolicyKeys = new Set(existing.policyKeys.map(lc))

  // Roles known after this plan runs (existing + ones we're about to create) —
  // used to validate wage-rate and requirement references.
  const knownRoles = new Set(existingRoles)
  const knownShiftTypes = new Set(existingShiftTypes)

  // ── Profile ────────────────────────────────────────────────────────────────
  if (bundle.profile && typeof bundle.profile === 'object') {
    const allowed: (keyof ProfileInput)[] = [
      'business_type', 'description', 'operating_hours', 'peak_periods', 'manager_priorities', 'special_context',
    ]
    const data: ProfileInput = {}
    for (const k of allowed) {
      const v = bundle.profile[k]
      if (typeof v === 'string' && v.trim()) data[k] = v.trim()
    }
    if (Object.keys(data).length > 0) steps.push({ kind: 'profile', data })
  }

  // ── Roles ────────────────────────────────────────────────────────────────
  const seenRoleNames = new Set<string>()
  for (const r of bundle.roles ?? []) {
    const name = typeof r?.name === 'string' ? r.name.trim() : ''
    if (!name) { warnings.push('Skipped a role with no name.'); continue }
    if (existingRoles.has(lc(name))) { warnings.push(`Role "${name}" already exists — left as is.`); continue }
    if (seenRoleNames.has(lc(name))) { warnings.push(`Role "${name}" was listed twice — added once.`); continue }
    let color: string | undefined
    if (r.color != null && r.color !== '') {
      if (typeof r.color === 'string' && HEX.test(r.color)) color = r.color
      else warnings.push(`Ignored an invalid color on role "${name}" (need a hex like #10b981).`)
    }
    seenRoleNames.add(lc(name))
    knownRoles.add(lc(name))
    steps.push({ kind: 'role', data: color ? { name, color } : { name } })
  }

  // ── Wage rates (need their role) ───────────────────────────────────────────
  const seenWageRoles = new Set<string>()
  for (const w of bundle.wage_rates ?? []) {
    const role = typeof w?.role === 'string' ? w.role.trim() : ''
    if (!role) { warnings.push('Skipped a wage rate with no role.'); continue }
    const rate = Number(w?.hourly_rate)
    if (!Number.isFinite(rate) || rate <= 0) { warnings.push(`Skipped the wage rate for "${role}" — needs a positive hourly rate.`); continue }
    if (!knownRoles.has(lc(role))) { warnings.push(`Skipped the wage rate for "${role}" — that role isn't defined.`); continue }
    if (existingWageRoles.has(lc(role)) || seenWageRoles.has(lc(role))) { warnings.push(`A wage rate for "${role}" already exists — left as is.`); continue }
    seenWageRoles.add(lc(role))
    steps.push({ kind: 'wage_rate', data: { role, hourly_rate: rate } })
  }

  // ── Shift types + their role requirements ──────────────────────────────────
  const seenShiftNames = new Set<string>()
  for (const st of bundle.shift_types ?? []) {
    const name = typeof st?.name === 'string' ? st.name.trim() : ''
    if (!name) { warnings.push('Skipped a shift with no name.'); continue }
    if (existingShiftTypes.has(lc(name))) { warnings.push(`Shift "${name}" already exists — left as is.`); continue }
    if (seenShiftNames.has(lc(name))) { warnings.push(`Shift "${name}" was listed twice — added once.`); continue }
    if (!st.start_time || !HHMM.test(st.start_time)) { warnings.push(`Skipped shift "${name}" — start time must be HH:MM.`); continue }
    if (!st.end_time || !HHMM.test(st.end_time)) { warnings.push(`Skipped shift "${name}" — end time must be HH:MM.`); continue }
    if (!Array.isArray(st.days_active) || st.days_active.length === 0 ||
        !st.days_active.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) {
      warnings.push(`Skipped shift "${name}" — needs the days it runs (Sunday–Saturday).`); continue
    }

    const requirements: { accepted_roles: string[]; required_count: number }[] = []
    for (const req of st.role_requirements ?? []) {
      const roles = Array.isArray(req?.accepted_roles)
        ? req.accepted_roles.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim())
        : []
      if (roles.length === 0) { warnings.push(`Skipped a role slot on "${name}" — it listed no role.`); continue }
      const count = req.required_count ?? 1
      if (!Number.isInteger(count) || count < 1) { warnings.push(`Skipped a role slot on "${name}" — count must be a whole number ≥ 1.`); continue }
      for (const role of roles) {
        if (!knownRoles.has(lc(role))) warnings.push(`Shift "${name}" needs role "${role}", which isn't defined — the slot is added but won't fill until that role exists.`)
      }
      requirements.push({ accepted_roles: roles, required_count: count })
    }

    seenShiftNames.add(lc(name))
    knownShiftTypes.add(lc(name))
    steps.push({
      kind: 'shift_type',
      data: { name, start_time: st.start_time, end_time: st.end_time, days_active: st.days_active },
      requirements,
    })
  }

  // ── Policies (upsert by key) ───────────────────────────────────────────────
  const seenPolicyKeys = new Set<string>()
  for (const p of bundle.policies ?? []) {
    const key = typeof p?.policy_key === 'string' ? p.policy_key.trim() : ''
    if (!key) { warnings.push('Skipped a policy with no key.'); continue }
    if (typeof p.policy_value !== 'string' || !p.policy_value.trim()) { warnings.push(`Skipped policy "${key}" — needs a human-readable value.`); continue }
    if (seenPolicyKeys.has(lc(key))) { warnings.push(`Policy "${key}" was listed twice — applied once.`); continue }
    if (existingPolicyKeys.has(lc(key))) warnings.push(`Policy "${key}" already exists — it will be updated.`)
    seenPolicyKeys.add(lc(key))
    const data: PolicyInput = { policy_key: key, policy_value: p.policy_value.trim() }
    if (Object.prototype.hasOwnProperty.call(p, 'policy_value_json')) data.policy_value_json = p.policy_value_json
    if (p.policy_type) data.policy_type = p.policy_type
    if (p.description !== undefined) data.description = p.description
    steps.push({ kind: 'policy', data })
  }

  // ── Veteran / experience rules (resolve shift name) ────────────────────────
  for (const v of bundle.veteran_rules ?? []) {
    if (v?.mode !== 'all_veterans' && v?.mode !== 'min_veterans') { warnings.push('Skipped a veteran rule with an unknown mode.'); continue }
    let minCount: number | null = null
    if (v.mode === 'min_veterans') {
      minCount = Number(v.min_count)
      if (!Number.isInteger(minCount) || minCount < 1) { warnings.push('Skipped a "minimum veterans" rule — needs a whole number of at least 1.'); continue }
    }
    for (const k of ['season_start', 'season_end'] as const) {
      const val = v[k]
      if (val != null && (typeof val !== 'string' || !DATE_RE.test(val))) { warnings.push(`Skipped a veteran rule — ${k} must be a date (YYYY-MM-DD).`); minCount = NaN; break }
    }
    if (Number.isNaN(minCount as number)) continue

    const shiftName = typeof v.shift_name === 'string' && v.shift_name.trim() ? v.shift_name.trim() : null
    if (shiftName && !knownShiftTypes.has(lc(shiftName))) { warnings.push(`Skipped a veteran rule for shift "${shiftName}" — that shift isn't defined.`); continue }
    const days = Array.isArray(v.days_of_week)
      ? v.days_of_week.filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
      : null
    steps.push({
      kind: 'veteran_rule',
      data: {
        shift_name: shiftName,
        days_of_week: days && days.length ? days : null,
        role: typeof v.role === 'string' && v.role.trim() ? v.role.trim() : null,
        mode: v.mode,
        min_count: v.mode === 'min_veterans' ? minCount : null,
        season_start: v.season_start ?? null,
        season_end: v.season_end ?? null,
      },
    })
  }

  const counts = {
    roles: steps.filter(s => s.kind === 'role').length,
    wage_rates: steps.filter(s => s.kind === 'wage_rate').length,
    shift_types: steps.filter(s => s.kind === 'shift_type').length,
    role_requirements: steps.reduce((n, s) => n + (s.kind === 'shift_type' ? s.requirements.length : 0), 0),
    policies: steps.filter(s => s.kind === 'policy').length,
    veteran_rules: steps.filter(s => s.kind === 'veteran_rule').length,
    profile: steps.filter(s => s.kind === 'profile').length,
  }

  return { steps, warnings, counts }
}

/** A short plain-English recap of what a plan will do, for confirmations/logs. */
export function summarizePlan(plan: IngestionPlan): string {
  const c = plan.counts
  const bits: string[] = []
  if (c.profile) bits.push('update the business profile')
  if (c.roles) bits.push(`${c.roles} role${c.roles === 1 ? '' : 's'}`)
  if (c.wage_rates) bits.push(`${c.wage_rates} wage rate${c.wage_rates === 1 ? '' : 's'}`)
  if (c.shift_types) bits.push(`${c.shift_types} shift${c.shift_types === 1 ? '' : 's'} (${c.role_requirements} role slot${c.role_requirements === 1 ? '' : 's'})`)
  if (c.policies) bits.push(`${c.policies} staffing rule${c.policies === 1 ? '' : 's'}`)
  if (c.veteran_rules) bits.push(`${c.veteran_rules} veteran rule${c.veteran_rules === 1 ? '' : 's'}`)
  if (bits.length === 0) return 'No new setup to apply.'
  return `Set up: ${bits.join(', ')}.`
}
