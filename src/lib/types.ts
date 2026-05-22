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
  shift_name: string
  role: string
  required_count: number
  start_time: string
  end_time: string
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
}

export interface ScheduleData {
  assignments: ScheduleAssignment[]
  gaps: ScheduleGap[]
  summary: string
  closed_dates?: string[]
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
  estimated_wages: {
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
  status: 'draft' | 'published' | 'approved'
  generated_by: string
  generated_at: string
  approved_at: string | null
  distributed_at: string | null
  data: ScheduleData
  staffing_report: StaffingReport | null
}

export interface Policy {
  id: string
  company_id: string
  policy_key: string
  policy_value: string
  policy_type: 'hours' | 'fairness' | 'eligibility' | 'overtime' | 'custom'
  description: string | null
  created_at: string
  version: number
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