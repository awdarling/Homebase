import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScheduleTemplate } from '@/lib/types'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DEFAULT_DAY_COLORS: Record<string, string> = {
  '0': '#8B0000', // Sunday   — dark red
  '1': '#FF8C00', // Monday   — orange
  '2': '#DAA520', // Tuesday  — golden
  '3': '#556B2F', // Wednesday — olive green
  '4': '#00008B', // Thursday — dark blue
  '5': '#4B0082', // Friday   — indigo
  '6': '#4169E1', // Saturday — royal blue
}

// week_start_day stored as a bare scalar string in policy_value_json.
// Tolerates a { value: 'monday' } wrapper for forward compat with the parser.
function unwrapWeekStartDay(v: unknown): 'sunday' | 'monday' {
  let s: unknown = v
  if (s !== null && typeof s === 'object' && !Array.isArray(s) && 'value' in (s as Record<string, unknown>)) {
    s = (s as Record<string, unknown>).value
  }
  return s === 'sunday' ? 'sunday' : 'monday'
}

/**
 * Build a ScheduleTemplate from a company's actual shift_types and week_start_day
 * policy. Returned when no schedule_templates row exists for the company.
 *
 * Row IDs MUST byte-for-byte equal the shift_name the Aegis engine writes to
 * assignments (sourced from shift_types.name). ScheduleRenderer matches via
 * exact string equality, so any drift drops assignments silently.
 *
 * Column day-of-week indices stay 0=Sun…6=Sat so the renderer's
 * parseYMD(date).getDay() === col.day lookup still works. week_start_day
 * only shifts the column ORDER.
 */
export async function buildDefault(
  companyId: string,
  supabase: SupabaseClient,
): Promise<ScheduleTemplate> {
  const now = new Date().toISOString()

  const shiftRes = await supabase
    .from('shift_types')
    .select('name, start_time')
    .eq('company_id', companyId)
    .eq('active', true)
    .order('start_time', { ascending: true })
    .order('name', { ascending: true })

  const shifts = (shiftRes.data ?? []) as Array<{ name: string; start_time: string }>

  const policyRes = await supabase
    .from('policies')
    .select('policy_value_json')
    .eq('company_id', companyId)
    .in('policy_key', ['week_start_day', 'first_day_of_week'])
    .limit(1)
    .maybeSingle()

  const weekStartDay = unwrapWeekStartDay(policyRes.data?.policy_value_json)
  const startDay = weekStartDay === 'sunday' ? 0 : 1

  const row_config = shifts.map((s, i) => ({
    id: s.name,
    label: s.name,
    height: 120,
    visible: true,
    order: i,
  }))

  const column_config = DAY_LABELS.map((label, i) => ({
    day: i,
    label,
    width: 180,
    color: DEFAULT_DAY_COLORS[String(i)],
    visible: true,
    order: (i - startDay + 7) % 7,
  }))

  return {
    id: '',
    company_id: companyId,
    layout_type: 'shift-rows-day-columns',
    row_config,
    column_config,
    color_config: {
      by: 'day',
      map: DEFAULT_DAY_COLORS,
    },
    display_options: {
      show_photos: false,
      font_size: 'sm',
      show_hours: true,
      show_role: true,
      show_start_end: false,
      compact: false,
    },
    created_at: now,
    updated_at: now,
  }
}
