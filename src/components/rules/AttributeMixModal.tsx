'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy, AttributeMixValue } from '@/lib/types'
import { savePolicy } from '@/lib/rules/save'
import { formatAttributeMix } from '@/lib/rules/categories'
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

type Attribute = 'sex' | 'is_veteran'

interface FormState {
  attribute: Attribute
  minMale: string
  minFemale: string
  minVeteran: string
  note: string
}

function readInitial(p: Policy | null): FormState {
  const note = p?.description ?? ''
  const v = p?.policy_value_json as AttributeMixValue | undefined
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.attribute === 'string') {
    if (v.attribute === 'sex') {
      const mins = v.minimums ?? {}
      return {
        attribute: 'sex',
        minMale: String(mins.male ?? 0),
        minFemale: String(mins.female ?? 0),
        minVeteran: '0',
        note,
      }
    }
    if (v.attribute === 'is_veteran') {
      const mins = v.minimums ?? {}
      return {
        attribute: 'is_veteran',
        minMale: '0',
        minFemale: '0',
        minVeteran: String(mins.true ?? 0),
        note,
      }
    }
  }
  return { attribute: 'sex', minMale: '0', minFemale: '0', minVeteran: '0', note }
}

export default function AttributeMixModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() => readInitial(existing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedMins: Record<string, number> = {}
  if (form.attribute === 'sex') {
    parsedMins.male = Math.max(0, parseInt(form.minMale, 10) || 0)
    parsedMins.female = Math.max(0, parseInt(form.minFemale, 10) || 0)
  } else {
    parsedMins.true = Math.max(0, parseInt(form.minVeteran, 10) || 0)
  }

  const minSum = Object.values(parsedMins).reduce((a, b) => a + b, 0)
  const canSave = minSum > 0

  async function handleSave() {
    if (!canSave) {
      setError('At least one minimum count must be greater than zero.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const value: AttributeMixValue = {
        attribute: form.attribute,
        minimums: parsedMins,
        scope: 'all_shifts',
      }
      const summaryText = formatAttributeMix(value)
      await savePolicy({
        supabase,
        companyId,
        category: 'attribute_mix',
        existing,
        policyValue: summaryText,
        policyValueJson: value,
        summary: existing ? `Updated attribute mix: ${summaryText}` : `Added attribute mix: ${summaryText}`,
        before: existing?.policy_value_json,
        user,
        isQuria,
        description: form.note.trim() || null,
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
      title={existing ? 'Edit attribute mix requirement' : 'Add attribute mix requirement'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={canSave}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Attribute</label>
        <select
          className="form-select"
          value={form.attribute}
          onChange={(e) => setForm((f) => ({ ...f, attribute: e.target.value as Attribute }))}
          disabled={!!existing}
        >
          <option value="sex">Sex</option>
          <option value="is_veteran">Veteran Status</option>
        </select>
        {existing && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            The attribute cannot be changed once the rule is saved. Remove and re-add to switch attributes.
          </div>
        )}
      </div>

      {form.attribute === 'sex' && (
        <>
          <div className="form-group">
            <label className="form-label">Minimum males per shift</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.minMale}
              onChange={(e) => setForm((f) => ({ ...f, minMale: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Minimum females per shift</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.minFemale}
              onChange={(e) => setForm((f) => ({ ...f, minFemale: e.target.value }))}
            />
          </div>
        </>
      )}

      {form.attribute === 'is_veteran' && (
        <>
          <div className="form-group">
            <label className="form-label">Minimum veterans per shift</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={1}
              value={form.minVeteran}
              onChange={(e) => setForm((f) => ({ ...f, minVeteran: e.target.value }))}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              To require non-veterans too, use Veteran Preference instead.
            </div>
          </div>
        </>
      )}

      <div className="form-group">
        <label className="form-label">Note (optional)</label>
        <textarea
          className="form-input"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          rows={2}
          placeholder="Why is this rule set this way? Anything Aegis or other managers should know."
          style={{ resize: 'vertical', minHeight: 50 }}
        />
      </div>
    </RulesModalShell>
  )
}
