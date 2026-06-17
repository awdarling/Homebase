export type SystemStatus = 'ready' | 'action_required' | 'awaiting_review' | 'blocked'

export interface Company {
  id: string
  name: string
  industry: string | null
  timezone: string
  created_at: string
  onboarding_complete: boolean
  billing_model: 'subscription' | 'one_time' | null
  stripe_price_id: string | null
}

export interface User {
  id: string
  company_id: string
  email: string
  name: string
  role: string
  created_at: string
}

export interface Employee {
  id: string
  company_id: string
  name: string
  primary_role: string
  qualified_roles: string[]
  max_weekly_hours: number
  contact_phone: string | null
  contact_email: string | null
  active: boolean
  created_at: string
  individual_wage?: number | null
  aegis_access?: 'manager' | 'employee' | 'blocked'
  is_veteran: boolean
  sex?: string | null
}

export interface Availability {
  id: string
  employee_id: string
  company_id: string
  day_of_week: number // 0 = Sunday, 6 = Saturday
  start_time: string  // HH:MM
  end_time: string    // HH:MM
}

export interface CustomAvailabilityPattern {
  day_of_week: number   // 0=Sunday, 6=Saturday
  start_time: string    // HH:MM
  end_time: string      // HH:MM
}

export interface CustomAvailabilityWeek {
  week: number          // 1-based
  days: CustomAvailabilityPattern[]
}

export interface CustomAvailability {
  id: string
  employee_id: string
  company_id: string
  type: 'date_limited' | 'rotating'
  end_date: string | null
  cycle_weeks: number | null
  cycle_start_date: string | null
  patterns: CustomAvailabilityPattern[] | CustomAvailabilityWeek[]
  active: boolean
  created_at: string
}

export interface PartialDayDetail {
  date: string
  type: 'shift_off' | 'custom_hours'
  shift_id?: string | null
  shift_name?: string | null
  start_time?: string | null
  end_time?: string | null
}

export interface ShiftOption {
  id: string
  shift_name: string
  start_time: string
  end_time: string
  role: string
  days_active: number[]
}

export interface TimeOffRequest {
  id: string
  employee_id: string
  company_id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  aegis_recommendation: 'approve' | 'deny' | 'neutral' | null
  aegis_reasoning: string | null
  time_off_type: 'full_day' | 'partial' | null
  partial_days: PartialDayDetail[] | null
  employee?: Employee
}

export interface ShiftRequirement {
  id: string
  company_id: string
  shift_type_id?: string | null
  accepted_roles: string[]
  required_count: number
  /** @deprecated use accepted_roles[0]. Kept for backwards compat with the Aegis engine until Block 3c. */
  role: string
  /**
   * @deprecated DO NOT READ. The Aegis engine ignores this field —
   * shift_types.name is the sole source of truth.
   * Column scheduled for removal in Block 3d.
   */
  shift_name: string
  /**
   * @deprecated DO NOT READ. The Aegis engine ignores this field —
   * shift_types.start_time is the sole source of truth.
   * Column scheduled for removal in Block 3d.
   */
  start_time: string
  /**
   * @deprecated DO NOT READ. The Aegis engine ignores this field —
   * shift_types.end_time is the sole source of truth.
   * Column scheduled for removal in Block 3d.
   */
  end_time: string
  /**
   * @deprecated DO NOT READ. The Aegis engine ignores this field —
   * shift_types.days_active is the sole source of truth.
   * Column scheduled for removal in Block 3d.
   */
  days_active: number[]
}

export interface ScheduleTemplate {
  id: string
  company_id: string
  layout_type: 'shift-rows-day-columns' | 'employee-rows-day-columns' | 'role-rows-day-columns'
  row_config: RowConfig[]
  column_config: ColumnConfig[]
  color_config: ColorConfig
  display_options: DisplayOptions
  created_at: string
  updated_at: string
}

export interface RowConfig {
  id: string           // shift_name or employee_id or role
  label: string        // display label
  height: number       // px height, default 120
  visible: boolean
  order: number
}

export interface ColumnConfig {
  day: number          // 0=Sun through 6=Sat
  label: string        // 'Sunday', 'Monday' etc
  width: number        // px width, default 180
  color: string        // hex color for this day column
  visible: boolean
  order: number
}

export interface ColorConfig {
  by: 'day' | 'role' | 'shift' | 'none'
  map: Record<string, string>  // key -> hex color
}

export interface DisplayOptions {
  show_photos: boolean         // default false
  font_size: 'sm' | 'md' | 'lg'  // default 'sm'
  show_hours: boolean          // default true
  show_role: boolean           // default true
  show_start_end: boolean      // default false
  compact: boolean             // default false
}

export interface ScheduleAssignment {
  date: string
  employee_id: string
  employee_name: string
  employee_photo?: string | null
  shift_name: string
  role: string
  start_time: string
  end_time: string
  hours: number
}

export interface ScheduleGap {
  date: string
  shift_name: string
  role: string
  required_count: number
  filled_count: number
  reason: string
  // Aegis writes these into schedules.data.gaps but Homebase's type historically
  // omitted them (drift). Optional so existing readers are unaffected; present so
  // the manager-facing gap reason can be surfaced. NOTE: the engine also writes
  // `per_employee_dispositions: EmployeeDisposition[]` — intentionally NOT modelled
  // here yet (needs the EmployeeDisposition type ported from Aegis; see PART B report).
  description?: string
  start_time?: string
  end_time?: string
}

// Mirrors Aegis's `FlaggedIssue` (src/workflows/schedule-build.ts) — the engine
// is the producer; this is the consumer copy. Discriminated union: the
// shift-scoped variant carries `shift_name`; the concurrent-coverage variant has
// NO shift_name and carries its time window in metadata (a coverage gap can
// straddle shifts). Keep in lockstep with the Aegis definition.
export type FlaggedIssue =
  | {
      type: 'unsatisfied_attribute_mix'
      date: string
      shift_name: string
      description: string
      metadata: Record<string, unknown>
    }
  | {
      type: 'unsatisfied_sex_coverage'
      date: string
      description: string
      metadata: {
        time_window: { start: string; end: string }
        missing_sex: string
        on_duty: Array<{ name: string; role: string; sex: string }>
      }
    }

export interface ScheduleData {
  assignments: ScheduleAssignment[]
  gaps: ScheduleGap[]
  // Optional: the Aegis engine writes data as {assignments, gaps, flagged_issues?}
  // and does NOT populate `summary` — only Homebase's Soteria-review save path does.
  // Made optional to match reality (the lone reader already null-guards).
  summary?: string
  closed_dates?: string[]
  flagged_issues?: FlaggedIssue[]
}

export interface StaffingReport {
  coverage_rate: number
  top_contributors: Array<{
    employee_id: string
    name: string
    hours: number
  }>
  bottom_contributors?: Array<{
    employee_id: string
    name: string
    hours: number
  }>
  overtime_risk: Array<{
    employee_id: string
    name: string
    hours: number
    max_hours: number
  }>
  gap_summary: string
  special_notes_applied: string[]
  aegis_notes: string
  /** @deprecated wages now compute-on-read per Block 3a. New writes do not populate this field; legacy rows may still have it. */
  estimated_wages?: {
    total_estimated: number
    by_employee: Array<{
      employee_id: string
      employee_name: string
      hours: number
      hourly_rate: number
      estimated_pay: number
    }>
  }
}

export interface Schedule {
  id: string
  company_id: string
  week_start: string
  week_end: string
  status: 'draft' | 'published' | 'approved' | 'distributed'
  generated_by: string
  generated_at: string
  approved_at: string | null
  distributed_at: string | null
  deleted_at: string | null
  data: ScheduleData
  staffing_report: StaffingReport | null
}

export interface Policy {
  id: string
  company_id: string
  policy_key: string
  policy_value: string
  policy_value_json: unknown | null
  policy_type: 'hours' | 'fairness' | 'eligibility' | 'overtime' | 'custom' | 'time_off'
  description: string | null
  created_at: string
  version: number
}

// Structured policy_value_json shapes recognized by the Aegis parser
// (`Aegis/src/lib/constraints/parser.ts`). Modals in src/components/rules
// write one of these (bare scalar / object) into Policy.policy_value_json.

export type WeekStartDayValue = 'sunday' | 'monday'

export interface AttributeMixValue {
  attribute: string
  minimums: Record<string, number>
  scope?: 'all_shifts' | 'shift_type' | 'specific_shift'
  scope_target?: string
}

export type VeteranPreferenceValue =
  | 'none'
  | 'prioritize'
  | 'at_least_one'
  | 'only'

export type HoursFairnessValue = number // [0, 1]

export type PartialShiftsValue = boolean

export type DoublesPolicyValue = 'never' | 'emergency_only' | 'allow'

export type ConflictResolutionValue = 'fairness_first' | 'minimize_disruption'

export type PolicyCategory =
  | 'week_start_day'
  | 'attribute_mix'
  | 'veteran_preference'
  | 'hours_fairness'
  | 'partial_shifts'
  | 'doubles_policy'
  | 'conflict_resolution'
  | 'legacy'

// Mirrors the parser's recognized key sets. Keep these in sync with
// `Aegis/src/lib/constraints/parser.ts`.
const POLICY_KEYS_BY_CATEGORY: Record<Exclude<PolicyCategory, 'legacy'>, readonly string[]> = {
  week_start_day: ['week_start_day', 'first_day_of_week'],
  attribute_mix: [
    'attribute_mix',
    'minimum_attribute_mix',
    'gender_requirement',
    'minimum_gender_requirement',
    'sex_requirement',
  ],
  veteran_preference: ['veteran_preference_default', 'veteran_default'],
  hours_fairness: ['hours_fairness_weight', 'fairness_weight'],
  partial_shifts: ['partial_shifts_allowed', 'allow_partial_shifts'],
  doubles_policy: ['doubles_policy', 'double_shifts'],
  conflict_resolution: ['conflict_resolution_preference', 'conflict_resolution'],
}

export function categorizePolicy(policy: Policy): PolicyCategory {
  const key = policy.policy_key
  for (const [category, keys] of Object.entries(POLICY_KEYS_BY_CATEGORY) as [
    Exclude<PolicyCategory, 'legacy'>,
    readonly string[],
  ][]) {
    if (keys.includes(key)) return category
  }
  return 'legacy'
}

// Canonical policy_key the modals write when CREATING a new row. When
// editing an existing row, callers should preserve the row's policy_key.
export const CANONICAL_POLICY_KEY: Record<Exclude<PolicyCategory, 'legacy'>, string> = {
  week_start_day: 'week_start_day',
  attribute_mix: 'attribute_mix',
  veteran_preference: 'veteran_preference_default',
  hours_fairness: 'hours_fairness_weight',
  partial_shifts: 'partial_shifts_allowed',
  doubles_policy: 'doubles_policy',
  conflict_resolution: 'conflict_resolution_preference',
}

export interface ActivityLog {
  id: string
  company_id: string
  actor: 'aegis' | 'manager' | 'soteria' | 'system' | 'quria_admin'
  actor_name: string | null
  actor_avatar_url: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AegisConversation {
  id: string
  company_id: string
  channel: 'email' | 'sms'
  direction: 'inbound' | 'outbound'
  content: string
  processed: boolean
  thread_id: string | null
  created_at: string
}

export interface ShiftType {
  id: string
  company_id: string
  name: string
  start_time: string
  end_time: string
  days_active: number[]
  active: boolean
  created_at: string
}

export interface WageRate {
  id: string
  company_id: string
  role: string
  hourly_rate: number
}

export interface WageRow {
  employee_id: string
  employee_name: string
  primary_role: string
  shifts: Array<{
    shift_name: string
    date: string
    hours: number
  }>
  total_hours: number
  hourly_rate: number | null
  estimated_pay: number | null
  rate_source: 'individual' | 'role' | 'unknown'
}

export interface TimeClockIntegration {
  id: string
  company_id: string
  provider: 'northstar' | 'manual'
  api_key: string | null
  api_base_url: string | null
  location_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface QuriaStaff {
  id: string
  email: string
  name: string
  contact_phone: string | null
  active: boolean
  created_at: string
}

export interface SwapRequest {
  id: string
  company_id: string
  requesting_employee_id: string
  receiving_employee_id: string | null
  shift_date: string
  shift_name: string
  role: string
  status: 'pending_employee' | 'pending_manager' | 'approved' | 'denied' | 'cancelled'
  initiated_by: 'employee' | 'manager' | 'aegis'
  notes: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export interface PayrollIntegration {
  id: string
  company_id: string
  provider: 'axios_engage' | 'manual'
  api_key: string | null
  company_identifier: string | null
  pay_period: 'weekly' | 'biweekly' | 'semimonthly'
  payroll_check_day: number
  auto_check_enabled: boolean
  last_run_at: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface BillingInfo {
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  subscription_price: number | null
  subscription_notes: string | null
  billing_email: string | null
  subscription_period_end: string | null
  cancel_at_period_end: boolean | null
  billing_model: 'subscription' | 'one_time' | null
  stripe_price_id: string | null
}

export type ShiftExperienceRuleMode = 'all_veterans' | 'min_veterans'

export interface ShiftExperienceRule {
  id: string
  company_id: string
  shift_type_id: string
  days_of_week: number[] | null
  role: string | null
  mode: ShiftExperienceRuleMode
  min_count: number | null
  season_start: string | null
  season_end: string | null
  active: boolean
  created_by: string | null
  created_at: string
}