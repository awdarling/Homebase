import type {
  Policy,
  PolicyCategory,
  AttributeMixValue,
  VeteranPreferenceValue,
  DoublesPolicyValue,
  ConflictResolutionValue,
  WeekStartDayValue,
} from '@/lib/types'

export interface CategoryMeta {
  key: Exclude<PolicyCategory, 'legacy'>
  label: string
  description: string
  engineEffect: string
  singleton: boolean
}

export const CATEGORY_LIST: CategoryMeta[] = [
  {
    key: 'week_start_day',
    label: 'Week Starts On',
    description: `Which day of the week your schedules start on. Affects how 'this week' and 'next week' are calculated when you request a build.`,
    engineEffect: `Aegis uses this to compute the date range when you say 'build this week' or 'build next week'. Sunday-Saturday and Monday-Sunday are both supported.`,
    singleton: true,
  },
  {
    key: 'attribute_mix',
    label: 'Attribute Mix Requirements',
    description: `Require a minimum number of employees with specific attributes on each shift. For example: at least 1 male and 1 female per shift, or at least 1 veteran on every shift.`,
    engineEffect: `Aegis refuses to leave a shift filled without satisfying every active attribute mix requirement. Unsatisfied requirements show as flagged gaps in the schedule summary.`,
    singleton: false,
  },
  {
    key: 'veteran_preference',
    label: 'Veteran Preference',
    description: `How Aegis treats employees flagged as veterans during candidate selection. This is a standing rule applied to every schedule build.`,
    engineEffect: `Aegis ranks veteran candidates higher (or restricts assignment entirely) depending on the mode. Choose 'none' to disable, 'prioritize' for soft preference, 'at_least_one' to try to place a veteran on every shift, 'only' to restrict shifts to veterans only.`,
    singleton: true,
  },
  {
    key: 'hours_fairness',
    label: 'Hours Fairness',
    description: `How strongly Aegis prioritizes candidates with fewer weekly hours when filling each slot. Higher values produce more even distribution across staff.`,
    engineEffect: `At weight 1.0, Aegis always picks the person with the fewest hours so far. At 0.0, hours are ignored. Default is around 0.8 — most clubs want even distribution.`,
    singleton: true,
  },
  {
    key: 'partial_shifts',
    label: 'Allow Partial Shifts',
    description: `Whether Aegis can assign an employee to only part of a shift when their availability covers some but not all of the time window.`,
    engineEffect: `When enabled, Aegis will assign an employee who can work, say, 9am-12pm of a 9am-3pm shift, and look for a second employee to cover the rest. When disabled (default), the engine requires full availability for the entire shift window.`,
    singleton: true,
  },
  {
    key: 'doubles_policy',
    label: 'Doubles (Same-Day Multiple Shifts)',
    description: `Whether an employee can be assigned to more than one shift on the same day.`,
    engineEffect: `Controls whether Aegis considers an employee for additional shifts after assigning them once on the same date. 'Never' is the default — once assigned, they're off the list for that day. 'Emergencies' only allows doubles when no other candidate is available. 'Always allow' treats each shift independently.`,
    singleton: true,
  },
  {
    key: 'conflict_resolution',
    label: 'Banned Pair Conflict Resolution',
    description: `What Aegis does when filling a shift would create a banned-pair conflict between two employees.`,
    engineEffect: `Aegis's cascade resolver always tries to swap one of the pair to a different shift first. This setting controls fallback behavior when the cascade exhausts options. 'Swap first' (default) keeps trying alternatives; 'Fill and flag' makes the assignment anyway and flags the conflict prominently in the manager summary.`,
    singleton: true,
  },
]

// Human-readable summary rendered on the Rules page for a singleton card.
// Reads policy_value_json (the engine-true value) and falls back to
// policy_value when policy_value_json is missing or unrecognizable.
export function formatPolicySummary(policy: Policy): string {
  const v = policy.policy_value_json
  switch (categorizeByKey(policy.policy_key)) {
    case 'week_start_day': {
      const s = unwrapScalar(v)
      if (s === 'monday') return 'Week starts on Monday.'
      if (s === 'sunday') return 'Week starts on Sunday.'
      return `Week starts on ${policy.policy_value || 'an unknown day'}.`
    }
    case 'attribute_mix': {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as AttributeMixValue
        return formatAttributeMix(o)
      }
      return policy.policy_value || 'Attribute mix requirement (unparseable).'
    }
    case 'veteran_preference': {
      const s = unwrapScalar(v) as VeteranPreferenceValue | undefined
      const label =
        s === 'none' ? 'None'
        : s === 'prioritize' ? 'Prioritize veterans'
        : s === 'at_least_one' ? 'Require at least one per shift'
        : s === 'only' ? 'Veterans only'
        : policy.policy_value || '(unset)'
      return `Veteran preference: ${label}.`
    }
    case 'hours_fairness': {
      const n = unwrapNumber(v)
      if (n === null) return policy.policy_value || 'Hours fairness (unset).'
      return `Hours fairness: ${n.toFixed(2)} (${hoursFairnessQualifier(n)}).`
    }
    case 'partial_shifts': {
      const b = unwrapBool(v)
      if (b === true) return 'Partial shifts: allowed.'
      if (b === false) return 'Partial shifts: disabled.'
      return policy.policy_value || 'Partial shifts (unset).'
    }
    case 'doubles_policy': {
      const s = unwrapScalar(v) as DoublesPolicyValue | undefined
      const label =
        s === 'never' ? 'Never'
        : s === 'emergency_only' ? 'Only in emergencies'
        : s === 'allow' ? 'Always allowed'
        : policy.policy_value || '(unset)'
      return `Doubles policy: ${label}.`
    }
    case 'conflict_resolution': {
      const s = unwrapScalar(v) as ConflictResolutionValue | undefined
      const label =
        s === 'fairness_first' ? 'Fairness first'
        : s === 'minimize_disruption' ? 'Minimize disruption'
        : policy.policy_value || '(unset)'
      return `Conflict resolution: ${label}.`
    }
    case null:
      return policy.policy_value || '(no value)'
  }
}

export function hoursFairnessQualifier(n: number): string {
  if (n <= 0.2) return 'ignore hours'
  if (n <= 0.5) return 'mild preference for low-hours staff'
  if (n <= 0.8) return 'strong preference for low-hours staff'
  return 'maximum hours fairness'
}

export function formatAttributeMix(v: AttributeMixValue): string {
  const attr = v.attribute
  const mins = v.minimums ?? {}
  const parts: string[] = []
  for (const [k, count] of Object.entries(mins)) {
    if (count <= 0) continue
    const label = humanizeAttributeValue(attr, k)
    parts.push(`${count} ${label}${count === 1 ? '' : ''}`)
  }
  if (parts.length === 0) return `${humanizeAttribute(attr)} requirement (no minimums set).`
  return `At least ${parts.join(' and ')} per shift.`
}

function humanizeAttribute(attr: string): string {
  if (attr === 'sex') return 'Sex'
  if (attr === 'is_veteran') return 'Veteran'
  return attr
}

function humanizeAttributeValue(attr: string, key: string): string {
  if (attr === 'sex') {
    if (key.toLowerCase() === 'male' || key.toLowerCase() === 'm') return 'male'
    if (key.toLowerCase() === 'female' || key.toLowerCase() === 'f') return 'female'
    return key
  }
  if (attr === 'is_veteran') {
    if (key === 'true') return 'veteran'
    if (key === 'false') return 'non-veteran'
  }
  return key
}

// Local copy of the categorizer that doesn't require a full Policy object —
// avoids a circular import back into '@/lib/types' from inside this module.
function categorizeByKey(key: string): Exclude<PolicyCategory, 'legacy'> | null {
  if (['week_start_day', 'first_day_of_week'].includes(key)) return 'week_start_day'
  if (['attribute_mix', 'minimum_attribute_mix', 'gender_requirement', 'minimum_gender_requirement', 'sex_requirement'].includes(key)) return 'attribute_mix'
  if (['veteran_preference_default', 'veteran_default'].includes(key)) return 'veteran_preference'
  if (['hours_fairness_weight', 'fairness_weight'].includes(key)) return 'hours_fairness'
  if (['partial_shifts_allowed', 'allow_partial_shifts'].includes(key)) return 'partial_shifts'
  if (['doubles_policy', 'double_shifts'].includes(key)) return 'doubles_policy'
  if (['conflict_resolution_preference', 'conflict_resolution'].includes(key)) return 'conflict_resolution'
  return null
}

function unwrapScalar(v: unknown): string | number | boolean | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'object' && !Array.isArray(v) && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') return inner
  }
  return undefined
}

function unwrapNumber(v: unknown): number | null {
  const s = unwrapScalar(v)
  return typeof s === 'number' && Number.isFinite(s) ? s : null
}

function unwrapBool(v: unknown): boolean | null {
  const s = unwrapScalar(v)
  return typeof s === 'boolean' ? s : null
}

// Re-exports used by Rules UI alongside CATEGORY_LIST.
export type { WeekStartDayValue, AttributeMixValue, VeteranPreferenceValue, DoublesPolicyValue, ConflictResolutionValue }
