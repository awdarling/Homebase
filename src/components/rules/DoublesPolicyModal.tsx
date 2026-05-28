'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy, DoublesPolicyValue } from '@/lib/types'
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

// Parser-accepted values: 'never' | 'emergency_only' | 'allow'.
const OPTIONS: { value: DoublesPolicyValue; label: string; summary: string }[] = [
  { value: 'never',          label: 'Never (default)',       summary: 'Never' },
  { value: 'emergency_only', label: 'Only in emergencies',   summary: 'Only in emergencies' },
  { value: 'allow',          label: 'Always allowed',        summary: 'Always allowed' },
]

function readInitial(p: Policy | null): DoublesPolicyValue {
  const v = p?.policy_value_json
  if (typeof v === 'string' && OPTIONS.some(o => o.value === v)) return v as DoublesPolicyValue
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string' && OPTIONS.some(o => o.value === inner)) return inner as DoublesPolicyValue
  }
  return 'never'
}

export default function DoublesPolicyModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<DoublesPolicyValue>(() => readInitial(existing))
  const [note, setNote] = useState<string>(() => existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const opt = OPTIONS.find(o => o.value === value)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await savePolicy({
        supabase,
        companyId,
        category: 'doubles_policy',
        existing,
        policyValue: opt?.summary ?? value,
        policyValueJson: value,
        summary: existing
          ? `Updated doubles policy: ${opt?.summary ?? value}`
          : `Set doubles policy to ${opt?.summary ?? value}`,
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
      title={existing ? 'Edit doubles policy' : 'Set doubles policy'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={!!opt}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Doubles Policy</label>
        <select
          className="form-select"
          value={value}
          onChange={(e) => setValue(e.target.value as DoublesPolicyValue)}
        >
          {OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Controls whether Aegis considers an employee for additional shifts after they&rsquo;ve already been assigned on the same date.
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
