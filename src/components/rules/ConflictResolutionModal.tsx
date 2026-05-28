'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy, ConflictResolutionValue } from '@/lib/types'
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

// Parser-accepted values: 'fairness_first' | 'minimize_disruption'.
const OPTIONS: { value: ConflictResolutionValue; label: string; summary: string }[] = [
  { value: 'fairness_first',      label: 'Fairness first (default)', summary: 'Fairness first' },
  { value: 'minimize_disruption', label: 'Minimize disruption',      summary: 'Minimize disruption' },
]

function readInitial(p: Policy | null): ConflictResolutionValue {
  const v = p?.policy_value_json
  if (typeof v === 'string' && OPTIONS.some(o => o.value === v)) return v as ConflictResolutionValue
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string' && OPTIONS.some(o => o.value === inner)) return inner as ConflictResolutionValue
  }
  return 'fairness_first'
}

export default function ConflictResolutionModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<ConflictResolutionValue>(() => readInitial(existing))
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
        category: 'conflict_resolution',
        existing,
        policyValue: opt?.summary ?? value,
        policyValueJson: value,
        summary: existing
          ? `Updated conflict resolution: ${opt?.summary ?? value}`
          : `Set conflict resolution to ${opt?.summary ?? value}`,
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
      title={existing ? 'Edit conflict resolution' : 'Set conflict resolution'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={!!opt}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Conflict Resolution Fallback</label>
        <select
          className="form-select"
          value={value}
          onChange={(e) => setValue(e.target.value as ConflictResolutionValue)}
        >
          {OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Fallback behavior when the banned-pair cascade resolver runs out of options. The engine recognizes these two values.
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
