'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy, VeteranPreferenceValue } from '@/lib/types'
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

const OPTIONS: { value: VeteranPreferenceValue; label: string }[] = [
  { value: 'none',         label: 'None' },
  { value: 'prioritize',   label: 'Prioritize veterans' },
  { value: 'at_least_one', label: 'Require at least one per shift' },
  { value: 'only',         label: 'Veterans only' },
]

function readInitial(p: Policy | null): VeteranPreferenceValue {
  const v = p?.policy_value_json
  if (typeof v === 'string' && OPTIONS.some(o => o.value === v)) return v as VeteranPreferenceValue
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string' && OPTIONS.some(o => o.value === inner)) return inner as VeteranPreferenceValue
  }
  return 'none'
}

export default function VeteranPreferenceModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<VeteranPreferenceValue>(() => readInitial(existing))
  const [note, setNote] = useState<string>(() => existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = OPTIONS.find(o => o.value === value)?.label ?? value

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await savePolicy({
        supabase,
        companyId,
        category: 'veteran_preference',
        existing,
        policyValue: label,
        policyValueJson: value,
        summary: existing
          ? `Updated veteran preference: ${label}`
          : `Set veteran preference to ${label}`,
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
      title={existing ? 'Edit veteran preference' : 'Set veteran preference'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={OPTIONS.some(o => o.value === value)}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Veteran Preference</label>
        <select
          className="form-select"
          value={value}
          onChange={(e) => setValue(e.target.value as VeteranPreferenceValue)}
        >
          {OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Applied to every schedule build. &lsquo;Prioritize&rsquo; is a soft preference; &lsquo;at least one&rsquo; and &lsquo;only&rsquo; are hard constraints.
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
