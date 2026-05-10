'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
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

// Row IDs MUST match the shift_name values used in assignments and the
// shift_types table (which use 'AM' for weekday and 'AM Weekend' with a
// space). ScheduleRenderer matches assignments to rows via row.id === a.shift_name.
const DEFAULT_SHIFTS = ['AM', 'AM Weekend', 'PM', 'Flex', 'Day']

function buildDefault(companyId: string): ScheduleTemplate {
  const now = new Date().toISOString()
  return {
    id: '',
    company_id: companyId,
    layout_type: 'shift-rows-day-columns',
    row_config: DEFAULT_SHIFTS.map((name, i) => ({
      id: name,
      label: name,
      height: 120,
      visible: true,
      order: i,
    })),
    column_config: DAY_LABELS.map((label, i) => ({
      day: i,
      label,
      width: 180,
      color: DEFAULT_DAY_COLORS[String(i)],
      visible: true,
      order: i,
    })),
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

export function useScheduleTemplate() {
  const { company } = useCompany()
  const companyId = company?.id ?? ''

  const [template, setTemplate] = useState<ScheduleTemplate | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('schedule_templates')
        .select('*')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (data) {
        setTemplate(data as ScheduleTemplate)
      } else {
        setTemplate(buildDefault(companyId))
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [companyId])

  const saveTemplate = useCallback(async (next: ScheduleTemplate) => {
    if (!companyId) return

    const payload = {
      ...next,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('schedule_templates')
      .upsert(payload, { onConflict: 'company_id' })
      .select()
      .single()

    if (!error && data) {
      setTemplate(data as ScheduleTemplate)
    }
  }, [companyId])

  return { template: template ?? (companyId ? buildDefault(companyId) : null), loading, saveTemplate }
}
