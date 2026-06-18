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
    description: `The day your schedule week begins. For example, if your week starts on Monday, a schedule runs Monday through Sunday.`,
    engineEffect: `When you ask Aegis to build "this week" or "next week," this tells it which day to start counting from. Both Sunday-to-Saturday and Monday-to-Sunday work.`,
    singleton: true,
  },
  {
    key: 'attribute_mix',
    label: 'Required Staff Mix',
    description: `Make sure every shift always has a certain kind of person on it. For example: at least one man and one woman on each shift, or at least one veteran on every shift.`,
    engineEffect: `Aegis won't call a shift done until it meets every mix you set here. If it can't — say there aren't enough women available — it leaves that shift flagged in your summary so you can see it. It never quietly ignores the rule.`,
    singleton: false,
  },
  {
    key: 'veteran_preference',
    label: 'Veteran Preference',
    description: `How much Aegis favors veterans when it's deciding who works. This applies to every schedule it builds.`,
    engineEffect: `Off: veterans are treated like everyone else. Prefer veterans: when two people are an equally good fit for a shift, the veteran gets it. At least one per shift: Aegis tries to put a veteran on every shift. Veterans only: only veterans can be placed.`,
    singleton: true,
  },
  {
    key: 'hours_fairness',
    label: 'Sharing Hours Evenly',
    description: `How hard Aegis works to spread hours evenly across your staff, by giving the next shift to whoever has worked the least so far.`,
    engineEffect: `Turned all the way up, Aegis always gives the next shift to the person with the fewest hours so far. Turned off, it ignores hours entirely. Most clubs keep it high so the work is shared fairly.`,
    singleton: true,
  },
  {
    key: 'partial_shifts',
    label: 'Allow Partial Shifts',
    description: `Whether someone can cover just part of a shift when they're only free for part of it.`,
    engineEffect: `When on, Aegis can put someone on, say, the 9am–12pm part of a 9am–3pm shift, then find a second person for the rest. When off (the default), a person has to be free for the whole shift to be placed on it.`,
    singleton: true,
  },
  {
    key: 'doubles_policy',
    label: 'Two Shifts in One Day',
    description: `Whether one person can be put on more than one shift on the same day.`,
    engineEffect: `Never (the default): once someone is on the schedule for a day, they're done for that day. Only in emergencies: Aegis gives someone a second shift that day only when no one else can cover it. Always allow: a second shift on the same day is fine.`,
    singleton: true,
  },
  {
    key: 'conflict_resolution',
    label: `When Two People Shouldn't Work Together`,
    description: `What Aegis does when a shift would put two people together who you've said shouldn't be paired up.`,
    engineEffect: `Aegis first tries to move one of the two to a different shift. This setting decides what happens if that isn't possible: keep looking for another arrangement, or make the assignment anyway and call it out clearly in your summary so you can decide.`,
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
      return policy.policy_value || 'Staff mix rule (couldn\'t read it).'
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
      if (n === null) return policy.policy_value || 'Sharing hours evenly (unset).'
      return `Sharing hours evenly: ${hoursFairnessQualifier(n)}.`
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
      return `Two shifts in one day: ${label}.`
    }
    case 'conflict_resolution': {
      const s = unwrapScalar(v) as ConflictResolutionValue | undefined
      const label =
        s === 'fairness_first' ? 'Keep it fair'
        : s === 'minimize_disruption' ? 'Avoid moving people around'
        : policy.policy_value || '(unset)'
      return `When two shouldn't work together: ${label}.`
    }
    case null:
      return policy.policy_value || '(no value)'
  }
}

export function hoursFairnessQualifier(n: number): string {
  if (n <= 0.2) return `hours aren't considered`
  if (n <= 0.5) return 'leans toward people with fewer hours'
  if (n <= 0.8) return 'strongly favors people with fewer hours'
  return 'always gives the next shift to whoever has the fewest hours'
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
