'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/activity'
import type { Policy } from '@/lib/types'
import RulesModalShell from './RulesModalShell'

interface Props {
  open: boolean
  existing: Policy
  companyId: string
  supabase: SupabaseClient
  user: { name?: string; avatar_url?: string | null } | null
  isQuria: boolean
  onClose: () => void
  onSaved: () => void
}

export default function LegacyPolicyModal({
  open, existing, companyId, supabase, user, isQuria, onClose, onSaved,
}: Props) {
  const [policyValue, setPolicyValue] = useState(existing.policy_value ?? '')
  const [description, setDescription] = useState(existing.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = policyValue.trim().length > 0

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const { error: upErr } = await supabase
        .from('policies')
        .update({
          policy_value: policyValue.trim(),
          description: description.trim() || null,
          version: (existing.version ?? 1) + 1,
        })
        .eq('id', existing.id)
        .eq('company_id', companyId)
      if (upErr) throw upErr

      await logActivity({
        supabase,
        company_id: companyId,
        action: 'policy_updated',
        entity_type: 'policy',
        entity_id: existing.id,
        summary: `Updated legacy rule "${existing.policy_key}": ${policyValue.trim()}`,
        metadata: {
          policy_id: existing.id,
          policy_key: existing.policy_key,
          before: existing.policy_value,
          after: policyValue.trim(),
        },
        isQuria,
        actorName: user?.name,
        actorAvatarUrl: user?.avatar_url ?? null,
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
      title={`Edit legacy rule: ${existing.policy_key}`}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={canSave}
      error={error}
    >
      <div className="form-group">
        <label className="form-label">Value</label>
        <input
          className="form-input"
          value={policyValue}
          onChange={(e) => setPolicyValue(e.target.value)}
          placeholder="Plain-text value Aegis can read."
        />
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea
          className="form-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this rule means and when Aegis should apply it."
          style={{ resize: 'vertical' }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          This row doesn&rsquo;t match a structured category. The engine doesn&rsquo;t parse it — it stays here as a note. Remove and recreate using a structured category above to make it active.
        </div>
      </div>
    </RulesModalShell>
  )
}
