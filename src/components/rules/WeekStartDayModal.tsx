'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy, WeekStartDayValue } from '@/lib/types'
import { savePolicy } from '@/lib/rules/save'
import RulesModalShell from './RulesModalShell'

interface Props {
  open: boolean
  existing: Policy | null
  companyId: string
  supabase: SupabaseClient
  user: { name?: string; avatar_url?: string | null } | null
  isQuria: boolean
  onClose: () => void
  onSaved: () => void
}

function readInitial(p: Policy | null): WeekStartDayValue {
  const v = p?.policy_value_json
  if (v === 'monday' || v === 'sunday') return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (inner === 'monday' || inner === 'sunday') return inner
  }
  return 'sunday'
}

export default function WeekStartDayModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<WeekStartDayValue>(() => readInitial(existing))
  const [note, setNote] = useState<string>(() => existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const label = value === 'monday' ? 'Monday' : 'Sunday'
      await savePolicy({
        supabase,
        companyId,
        category: 'week_start_day',
        existing,
        policyValue: label,
        policyValueJson: value,
        summary: existing
          ? `Updated week start: ${label}`
          : `Set week start to ${label}`,
        before: existing?.policy_value_json,
        user,
        isQuria,
        description: note.trim() || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <RulesModalShell
      open={open}
      title={existing ? 'Edit week start day' : 'Set week start day'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={value === 'sunday' || value === 'monday'}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Week Starts On</label>
        <select
          className="form-select"
          value={value}
          onChange={(e) => setValue(e.target.value as WeekStartDayValue)}
        >
          <option value="sunday">Sunday</option>
          <option value="monday">Monday</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Aegis uses this to decide which dates count as &lsquo;this week&rsquo; or &lsquo;next week&rsquo; when you request a build.
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Note (optional)</label>
        <textarea
          className="form-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why is this rule set this way? Anything Aegis or other managers should know."
          style={{ resize: 'vertical', minHeight: 50 }}
        />
      </div>
    </RulesModalShell>
  )
}
