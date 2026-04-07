export type SystemStatus = 'ready' | 'action_required' | 'awaiting_review' | 'blocked'

export interface Company {
  id: string
  name: string
  industry: string | null
  timezone: string
  created_at: string
  onboarding_complete: boolean
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
}

export interface Availability {
  id: string
  employee_id: string
  company_id: string
  day_of_week: number // 0 = Sunday, 6 = Saturday
  start_time: string  // HH:MM
  end_time: string    // HH:MM
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
  employee?: Employee
}

export interface ShiftRequirement {
  id: string
  company_id: string
  shift_name: string
  role: string
  required_count: number
  start_time: string
  end_time: string
  days_active: number[]
}

export interface Schedule {
  id: string
  company_id: string
  week_start: string
  week_end: string
  generated_at: string
  generated_by: 'aegis' | 'manager'
  status: 'draft' | 'published'
  data: ScheduleData
}

export interface ScheduleData {
  assignments: ScheduleAssignment[]
  gaps: ScheduleGap[]
  summary: string
}

export interface ScheduleAssignment {
  employee_id: string
  employee_name: string
  shift_name: string
  role: string
  date: string
  start_time: string
  end_time: string
}

export interface ScheduleGap {
  shift_name: string
  role: string
  date: string
  required: number
  filled: number
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
  actor: 'aegis' | 'manager' | 'soteria' | 'system'
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
