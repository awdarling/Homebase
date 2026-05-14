'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ScheduleAssignment, WageRow } from '@/lib/types'

interface EmployeeRow {
  id: string
  name: string
  primary_role: string
  individual_wage: number | null
}

interface WageRateRow {
  role: string
  hourly_rate: number
}

export function useWageBreakdown({
  assignments,
  companyId,
}: {
  assignments: ScheduleAssignment[]
  companyId: string
}) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [wageRates, setWageRates] = useState<WageRateRow[]>([])
  const [loading, setLoading] = useState(true)

  // Stable key for the set of employee_ids — only changes when the set changes,
  // not when the manager just shuffles the same employees between cells.
  const employeeIdsKey = useMemo(() => {
    const ids = Array.from(new Set(assignments.map(a => a.employee_id))).sort()
    return ids.join(',')
  }, [assignments])

  useEffect(() => {
    let cancelled = false

    async function fetchRates() {
      if (!companyId) {
        setEmployees([])
        setWageRates([])
        setLoading(false)
        return
      }

      setLoading(true)
      const ids = employeeIdsKey ? employeeIdsKey.split(',') : []
      const supabase = createClient()

      const [empRes, wageRes] = await Promise.all([
        ids.length > 0
          ? supabase.from('employees').select('id, name, primary_role, individual_wage').in('id', ids)
          : Promise.resolve({ data: [] as EmployeeRow[] }),
        supabase.from('wage_rates').select('role, hourly_rate').eq('company_id', companyId),
      ])

      if (cancelled) return
      setEmployees((empRes.data ?? []) as EmployeeRow[])
      setWageRates((wageRes.data ?? []) as WageRateRow[])
      setLoading(false)
    }

    fetchRates()
    return () => { cancelled = true }
  }, [companyId, employeeIdsKey])

  const { rows, totals } = useMemo(() => {
    const empById = new Map<string, EmployeeRow>()
    for (const e of employees) empById.set(e.id, e)

    const rateByRole = new Map<string, number>()
    for (const r of wageRates) rateByRole.set(r.role, r.hourly_rate)

    const grouped = new Map<string, WageRow>()
    for (const a of assignments) {
      let row = grouped.get(a.employee_id)
      if (!row) {
        const emp = empById.get(a.employee_id)
        const primary = emp?.primary_role ?? a.role
        let rate: number | null = null
        let source: WageRow['rate_source'] = 'unknown'
        if (emp?.individual_wage != null) {
          rate = emp.individual_wage
          source = 'individual'
        } else {
          const roleRate = rateByRole.get(primary)
          if (roleRate != null) {
            rate = roleRate
            source = 'role'
          }
        }
        row = {
          employee_id: a.employee_id,
          employee_name: emp?.name ?? a.employee_name,
          primary_role: primary,
          shifts: [],
          total_hours: 0,
          hourly_rate: rate,
          estimated_pay: null,
          rate_source: source,
        }
        grouped.set(a.employee_id, row)
      }
      row.shifts.push({ shift_name: a.shift_name, date: a.date, hours: a.hours ?? 0 })
      row.total_hours += a.hours ?? 0
    }

    const rowList: WageRow[] = []
    grouped.forEach((row) => {
      row.total_hours = Math.round(row.total_hours * 100) / 100
      row.estimated_pay = row.hourly_rate != null
        ? Math.round(row.total_hours * row.hourly_rate * 100) / 100
        : null
      rowList.push(row)
    })
    rowList.sort((a, b) => b.total_hours - a.total_hours)

    let totalHours = 0
    let totalPay = 0
    for (const r of rowList) {
      totalHours += r.total_hours
      if (r.estimated_pay != null) totalPay += r.estimated_pay
    }

    return {
      rows: rowList,
      totals: {
        hours: Math.round(totalHours * 100) / 100,
        estimated_pay: Math.round(totalPay * 100) / 100,
      },
    }
  }, [assignments, employees, wageRates])

  return { rows, totals, loading }
}
