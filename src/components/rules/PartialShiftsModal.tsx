'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy } from '@/lib/types'
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

function readInitial(p: Policy | null): boolean {
  const v = p?.policy_value_json
  if (typeof v === 'boolean') return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'boolean') return inner
  }
  return false
}

export default function PartialShiftsModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [value, setValue] = useState<boolean>(() => readInitial(existing))
  const [note, setNote] = useState<string>(() => existing?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const label = value ? 'Allowed' : 'Disabled'
      await savePolicy({
        supabase,
        companyId,
        category: 'partial_shifts',
        existing,
        policyValue: label,
        policyValueJson: value,
        summary: existing
          ? `Updated partial shifts: ${label.toLowerCase()}`
          : `Set partial shifts to ${label.toLowerCase()}`,
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
      title={existing ? 'Edit partial shifts' : 'Set partial shifts'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={true}
      error={error}
    >
      <div className="form-group">
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            padding: '10px 14px',
            background: 'var(--bg-surface-3)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => setValue(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
          />
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
            Allow partial shift assignments
          </div>
        </label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          When on, Aegis can assign an employee whose availability covers only part of the shift window, and look for a second employee to fill the rest. When off, the engine requires full availability for the entire window.
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
