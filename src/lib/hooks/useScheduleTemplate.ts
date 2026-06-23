'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import { buildDefault } from '@/lib/schedule/buildDefaultTemplate'
import { toSaveTemplateResult, type SaveTemplateResult } from '@/lib/schedule/templateSave'
import type { ScheduleTemplate } from '@/lib/types'

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
        const built = await buildDefault(companyId, supabase)
        if (cancelled) return
        setTemplate(built)
      }
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [companyId])

  const saveTemplate = useCallback(async (next: ScheduleTemplate): Promise<SaveTemplateResult> => {
    if (!companyId) return { ok: false, error: 'No company is loaded yet — please refresh and try again.' }

    // Strip empty id so the gen_random_uuid() default fires on first insert.
    // The unique constraint on company_id still routes upsert correctly:
    // existing rows are matched by company_id and updated regardless of id.
    const { id, ...rest } = next
    const base = id ? next : rest
    const payload = {
      ...base,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    }

    const outcome = await supabase
      .from('schedule_templates')
      .upsert(payload, { onConflict: 'company_id' })
      .select()
      .single()

    const result = toSaveTemplateResult(outcome)
    if (result.ok) setTemplate(result.template)
    return result
  }, [companyId])

  return { template, loading, saveTemplate }
}
