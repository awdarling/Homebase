'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Policy } from '@/lib/types'
import { logActivity } from '@/lib/activity'

interface Props {
  policies: Policy[]
  companyId: string
  supabase: SupabaseClient
  user: { name?: string; avatar_url?: string | null } | null
  isQuria: boolean
  onChanged: () => Promise<void> | void
}

type TimeOffKey = 'max_consecutive_days_off' | 'min_notice_period_days'

interface RowConfig {
  key: TimeOffKey
  label: string
  helper: string
  defaultDescription: string
}

const ROWS: RowConfig[] = [
  {
    key: 'max_consecutive_days_off',
    label: 'Maximum consecutive days off',
    helper:
      'Soft rule — TO is still recorded; the manager notification email flags any violation.',
    defaultDescription:
      'Maximum number of consecutive days an employee can have off before manager review is suggested.',
  },
  {
    key: 'min_notice_period_days',
    label: 'Minimum notice period (days)',
    helper:
      'Soft rule — TO is still recorded; the manager notification email flags any violation.',
    defaultDescription:
      'Minimum days of advance notice required for time-off requests.',
  },
]

function readCurrentValue(p: Policy | undefined): number | null {
  if (!p) return null
  const j = p.policy_value_json
  if (typeof j === 'number' && Number.isFinite(j)) return j
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const inner = (j as Record<string, unknown>).value
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner
  }
  const parsed = Number(p.policy_value)
  return Number.isFinite(parsed) ? parsed : null
}

export default function TimeOffManagementSection({
  policies,
  companyId,
  supabase,
  user,
  isQuria,
  onChanged,
}: Props) {
  const byKey = new Map<TimeOffKey, Policy>()
  for (const p of policies) {
    if (p.policy_key === 'max_consecutive_days_off' || p.policy_key === 'min_notice_period_days') {
      byKey.set(p.policy_key, p)
    }
  }

  return (
    <section
      style={{
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)',
        padding: '18px 20px 20px',
      }}
    >
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
          lineHeight: 1.3,
          marginBottom: 6,
        }}
      >
        Time Off Management
      </h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
        Soft thresholds the manager notification email checks against when employees submit time off.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ROWS.map((row) => (
          <TimeOffRow
            key={row.key}
            config={row}
            policy={byKey.get(row.key)}
            companyId={companyId}
            supabase={supabase}
            user={user}
            isQuria={isQuria}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  )
}

interface RowProps {
  config: RowConfig
  policy: Policy | undefined
  companyId: string
  supabase: SupabaseClient
  user: { name?: string; avatar_url?: string | null } | null
  isQuria: boolean
  onChanged: () => Promise<void> | void
}

function TimeOffRow({ config, policy, companyId, supabase, user, isQuria, onChanged }: RowProps) {
  const currentValue = readCurrentValue(policy)
  const [input, setInput] = useState<string>(currentValue !== null ? String(currentValue) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInput(currentValue !== null ? String(currentValue) : '')
  }, [currentValue])

  const parsed = Number(input)
  const isValid = input.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
  const isDirty = isValid && parsed !== currentValue

  async function handleSave() {
    if (!policy || !isValid || !isDirty) return
    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('policies')
        .update({
          policy_value: String(parsed),
          policy_value_json: parsed,
          version: (policy.version ?? 1) + 1,
        })
        .eq('id', policy.id)
        .eq('company_id', companyId)
      if (updateError) throw updateError

      await logActivity({
        supabase,
        company_id: companyId,
        action: 'policy_updated',
        entity_type: 'policy',
        entity_id: policy.id,
        summary: `Updated ${config.key} from ${currentValue ?? '(unset)'} to ${parsed}`,
        metadata: {
          policy_id: policy.id,
          policy_key: config.key,
          before: currentValue,
          after: parsed,
        },
        isQuria,
        actorName: user?.name,
        actorAvatarUrl: user?.avatar_url ?? null,
      })

      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateDefault() {
    setSaving(true)
    setError(null)
    try {
      const defaultValue = 7
      const { data, error: insertError } = await supabase
        .from('policies')
        .insert({
          company_id: companyId,
          policy_key: config.key,
          policy_value: String(defaultValue),
          policy_value_json: defaultValue,
          policy_type: 'time_off',
          description: config.defaultDescription,
          version: 1,
        })
        .select('id')
        .single()
      if (insertError) throw insertError

      await logActivity({
        supabase,
        company_id: companyId,
        action: 'policy_added',
        entity_type: 'policy',
        entity_id: (data as { id: string }).id,
        summary: `Created ${config.key} with default value ${defaultValue}`,
        metadata: {
          policy_id: (data as { id: string }).id,
          policy_key: config.key,
          after: defaultValue,
        },
        isQuria,
        actorName: user?.name,
        actorAvatarUrl: user?.avatar_url ?? null,
      })

      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!policy) {
    return (
      <div
        style={{
          background: 'var(--bg-surface-1)',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
              {config.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>
              Not configured
            </div>
          </div>
          <button
            onClick={handleCreateDefault}
            disabled={saving}
            style={{
              background: 'var(--accent)',
              color: '#000',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Setting…' : 'Set to 7 days'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {config.helper}
        </div>
        {error && (
          <div style={{ fontSize: 11, color: 'var(--status-blocked-text)' }}>{error}</div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
            {config.label}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--accent)',
              lineHeight: 1.2,
              marginTop: 2,
            }}
          >
            {currentValue ?? '—'}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginLeft: 6 }}>
              days
            </span>
          </div>
          {policy.description && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              {policy.description}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            min={0}
            step={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={saving}
            className="form-input"
            style={{ width: 80, textAlign: 'center' }}
          />
          <button
            onClick={handleSave}
            disabled={!isDirty || !isValid || saving}
            className="btn btn-sm"
            style={{
              background: isDirty && isValid ? 'var(--accent)' : 'var(--bg-surface-2)',
              color: isDirty && isValid ? '#000' : 'var(--text-muted)',
              border: 'none',
              cursor: isDirty && isValid && !saving ? 'pointer' : 'default',
              opacity: saving ? 0.6 : 1,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {config.helper}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: 'var(--status-blocked-text)' }}>{error}</div>
      )}
    </div>
  )
}
