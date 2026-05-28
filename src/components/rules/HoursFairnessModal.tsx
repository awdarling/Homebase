'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy } from '@/lib/types'
import { savePolicy } from '@/lib/rules/save'
import { hoursFairnessQualifier } from '@/lib/rules/categories'
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

function readInitial(p: Policy | null): number {
  const v = p?.policy_value_json
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'number' && Number.isFinite(inner) && inner >= 0 && inner <= 1) return inner
  }
  return 0.8 // PART 4.4 default for new rule
}

export default function HoursFairnessModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<number>(() => readInitial(existing))
  const [note, setNote] = useState<string>(() => existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const qualifier = hoursFairnessQualifier(value)
  const canSave = Number.isFinite(value) && value >= 0 && value <= 1

  async function handleSave() {
    if (!canSave) {
      setError('Value must be between 0 and 1.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const numericLabel = value.toFixed(2)
      await savePolicy({
        supabase,
        companyId,
        category: 'hours_fairness',
        existing,
        policyValue: numericLabel,
        policyValueJson: value,
        summary: existing
          ? `Updated hours fairness: ${numericLabel}`
          : `Set hours fairness to ${numericLabel}`,
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
      title={existing ? 'Edit hours fairness' : 'Set hours fairness'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={canSave}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Hours Fairness Weight</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => setValue(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginTop: 8,
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--accent)',
            minWidth: 56,
          }}>
            {value.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{qualifier}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          At weight 1.0 Aegis always picks the candidate with the fewest hours so far. At 0.0 hours are ignored. Most clubs run somewhere around 0.7–0.8.
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{
          display: 'block',
          fontSize: 11,
          color: 'var(--text-muted)',
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}>
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why is this rule set this way? Anything Aegis or other managers should know."
          style={{
            width: '100%',
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 10px',
            fontSize: 12,
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 50,
          }}
        />
      </div>
    </RulesModalShell>
  )
}
