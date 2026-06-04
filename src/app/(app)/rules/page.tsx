'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'
import { categorizePolicy } from '@/lib/types'
import type { Policy, PolicyCategory } from '@/lib/types'
import { CATEGORY_LIST, formatPolicySummary } from '@/lib/rules/categories'
import { removePolicy } from '@/lib/rules/save'
import TimeOffManagementSection from '@/components/rules/TimeOffManagementSection'
import WeekStartDayModal from '@/components/rules/WeekStartDayModal'
import AttributeMixModal from '@/components/rules/AttributeMixModal'
import VeteranPreferenceModal from '@/components/rules/VeteranPreferenceModal'
import HoursFairnessModal from '@/components/rules/HoursFairnessModal'
import PartialShiftsModal from '@/components/rules/PartialShiftsModal'
import DoublesPolicyModal from '@/components/rules/DoublesPolicyModal'
import ConflictResolutionModal from '@/components/rules/ConflictResolutionModal'
import LegacyPolicyModal from '@/components/rules/LegacyPolicyModal'

const EMPTY_BUCKETS: Record<PolicyCategory, Policy[]> = {
  week_start_day: [],
  attribute_mix: [],
  veteran_preference: [],
  hours_fairness: [],
  partial_shifts: [],
  doubles_policy: [],
  conflict_resolution: [],
  legacy: [],
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

type EditTarget =
  | { kind: 'category'; category: Exclude<PolicyCategory, 'legacy'>; existing: Policy | null }
  | { kind: 'legacy'; policy: Policy }
  | null

export default function RulesPage() {
  const { company, user, loading: companyLoading } = useCompany()
  const { isQuria } = useQuria()
  const COMPANY_ID = company?.id ?? ''
  const supabase = useMemo(() => createClient(), [])

  const [policiesByCategory, setPoliciesByCategory] =
    useState<Record<PolicyCategory, Policy[]>>(EMPTY_BUCKETS)
  const [timeOffPolicies, setTimeOffPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [legacyExpanded, setLegacyExpanded] = useState(false)
  const [openEngineEffect, setOpenEngineEffect] = useState<string | null>(null)

  useEffect(() => {
    if (companyLoading) return
    if (!COMPANY_ID) { setLoading(false); return }
    void fetchPolicies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COMPANY_ID, companyLoading])

  async function fetchPolicies() {
    setLoading(true)
    const { data } = await supabase
      .from('policies')
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('policy_key')
    const buckets: Record<PolicyCategory, Policy[]> = {
      week_start_day: [],
      attribute_mix: [],
      veteran_preference: [],
      hours_fairness: [],
      partial_shifts: [],
      doubles_policy: [],
      conflict_resolution: [],
      legacy: [],
    }
    const timeOff: Policy[] = []
    for (const p of (data ?? []) as Policy[]) {
      if (
        p.policy_type === 'time_off' ||
        p.policy_key === 'max_consecutive_days_off' ||
        p.policy_key === 'min_notice_period_days'
      ) {
        timeOff.push(p)
        continue
      }
      buckets[categorizePolicy(p)].push(p)
    }
    setPoliciesByCategory(buckets)
    setTimeOffPolicies(timeOff)
    setLoading(false)
  }

  async function handleRemove(policy: Policy) {
    try {
      await removePolicy({
        supabase,
        companyId: COMPANY_ID,
        policy,
        summary: `Removed rule: ${policy.policy_key.replace(/_/g, ' ')}`,
        user: user ? { name: user.name, avatar_url: user.avatar_url } : null,
        isQuria,
      })
      setConfirmRemoveId(null)
      await fetchPolicies()
    } catch (e) {
      console.error('Remove policy failed:', e)
      setConfirmRemoveId(null)
    }
  }

  function modalForCategory(category: Exclude<PolicyCategory, 'legacy'>, existing: Policy | null) {
    const common = {
      open: true,
      existing,
      companyId: COMPANY_ID,
      supabase,
      user: user ? { name: user.name, avatar_url: user.avatar_url } : null,
      isQuria,
      onClose: () => setEditTarget(null),
      onSaved: async () => { setEditTarget(null); await fetchPolicies() },
    }
    switch (category) {
      case 'week_start_day':     return <WeekStartDayModal     {...common} />
      case 'attribute_mix':      return <AttributeMixModal     {...common} />
      case 'veteran_preference': return <VeteranPreferenceModal {...common} />
      case 'hours_fairness':     return <HoursFairnessModal    {...common} />
      case 'partial_shifts':     return <PartialShiftsModal    {...common} />
      case 'doubles_policy':     return <DoublesPolicyModal    {...common} />
      case 'conflict_resolution':return <ConflictResolutionModal {...common} />
    }
  }

  if (companyLoading || loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading rules…
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Rules</div>
        <div className="page-subtitle">Configure how Aegis builds your schedules.</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <TimeOffManagementSection
          policies={timeOffPolicies}
          companyId={COMPANY_ID}
          supabase={supabase}
          user={user ? { name: user.name, avatar_url: user.avatar_url } : null}
          isQuria={isQuria}
          onChanged={fetchPolicies}
        />

        {CATEGORY_LIST.map((cat) => {
          const rows = policiesByCategory[cat.key]
          const showInfo = openEngineEffect === cat.key
          return (
            <section
              key={cat.key}
              style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-xl)',
                padding: '18px 20px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                <h2 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  margin: 0,
                  flex: 1,
                  lineHeight: 1.3,
                }}>
                  {cat.label}
                </h2>
                <button
                  onClick={() => setOpenEngineEffect(showInfo ? null : cat.key)}
                  aria-label={`What does ${cat.label} do?`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: showInfo ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: 2,
                  }}
                  title="Show engine effect"
                  onMouseEnter={() => setOpenEngineEffect(cat.key)}
                  onMouseLeave={() => setOpenEngineEffect(null)}
                >
                  <InfoIcon />
                </button>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                {cat.description}
              </div>

              {showInfo && (
                <div style={{
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                  marginBottom: 12,
                }}>
                  <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                    Engine Effect
                  </div>
                  {cat.engineEffect}
                </div>
              )}

              <RulesCategoryBody
                category={cat.key}
                singleton={cat.singleton}
                rows={rows}
                onAdd={() => setEditTarget({ kind: 'category', category: cat.key, existing: null })}
                onEdit={(p) => setEditTarget({ kind: 'category', category: cat.key, existing: p })}
                onConfirmRemove={(id) => setConfirmRemoveId(id)}
                confirmRemoveId={confirmRemoveId}
                onCancelRemove={() => setConfirmRemoveId(null)}
                onRemove={handleRemove}
              />
            </section>
          )
        })}

        {policiesByCategory.legacy.length > 0 && (
          <section
            style={{
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-xl)',
              padding: '14px 20px',
            }}
          >
            <button
              onClick={() => setLegacyExpanded(v => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 0,
                color: 'var(--text-secondary)',
              }}
            >
              <ChevronIcon open={legacyExpanded} />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}>
                Legacy / Unstructured Rules ({policiesByCategory.legacy.length})
              </span>
            </button>

            {legacyExpanded && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                  These rules don&rsquo;t match a structured category yet. Edit them in free-text, or remove them and recreate using a structured category above.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {policiesByCategory.legacy.map((p) => (
                    <LegacyRow
                      key={p.id}
                      policy={p}
                      onEdit={() => setEditTarget({ kind: 'legacy', policy: p })}
                      onConfirmRemove={() => setConfirmRemoveId(p.id)}
                      confirmRemoveId={confirmRemoveId}
                      onCancelRemove={() => setConfirmRemoveId(null)}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {editTarget?.kind === 'category' && modalForCategory(editTarget.category, editTarget.existing)}
      {editTarget?.kind === 'legacy' && (
        <LegacyPolicyModal
          open
          existing={editTarget.policy}
          companyId={COMPANY_ID}
          supabase={supabase}
          user={user ? { name: user.name, avatar_url: user.avatar_url } : null}
          isQuria={isQuria}
          onClose={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await fetchPolicies() }}
        />
      )}
    </div>
  )
}

interface CategoryBodyProps {
  category: Exclude<PolicyCategory, 'legacy'>
  singleton: boolean
  rows: Policy[]
  onAdd: () => void
  onEdit: (p: Policy) => void
  onConfirmRemove: (id: string) => void
  confirmRemoveId: string | null
  onCancelRemove: () => void
  onRemove: (p: Policy) => void
}

function RulesCategoryBody({
  category, singleton, rows, onAdd, onEdit, onConfirmRemove, confirmRemoveId, onCancelRemove, onRemove,
}: CategoryBodyProps) {
  if (rows.length === 0) {
    return (
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px dashed var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No rule set. Aegis uses its default.
        </div>
        <button
          onClick={onAdd}
          style={{
            background: 'var(--accent)',
            color: '#000',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Add Rule
        </button>
      </div>
    )
  }

  const multiple = singleton && rows.length > 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {multiple && (
        <div style={{
          background: 'var(--status-blocked-bg)',
          border: '1px solid var(--status-blocked-border)',
          color: 'var(--status-blocked-text)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          fontSize: 11,
          lineHeight: 1.5,
        }}>
          Multiple rules of this type — Aegis uses the most recent. Remove duplicates.
        </div>
      )}
      {rows.map((p) => (
        <RuleCard
          key={p.id}
          policy={p}
          onEdit={() => onEdit(p)}
          onConfirmRemove={() => onConfirmRemove(p.id)}
          confirmRemoveId={confirmRemoveId}
          onCancelRemove={onCancelRemove}
          onRemove={onRemove}
        />
      ))}
      {!singleton && (
        <button
          onClick={onAdd}
          style={{
            alignSelf: 'flex-start',
            background: 'var(--accent)',
            color: '#000',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            marginTop: 4,
          }}
        >
          + Add {category === 'attribute_mix' ? 'Attribute Mix' : 'Rule'}
        </button>
      )}
    </div>
  )
}

interface RuleCardProps {
  policy: Policy
  onEdit: () => void
  onConfirmRemove: () => void
  confirmRemoveId: string | null
  onCancelRemove: () => void
  onRemove: (p: Policy) => void
}

function RuleCard({ policy, onEdit, onConfirmRemove, confirmRemoveId, onCancelRemove, onRemove }: RuleCardProps) {
  const confirming = confirmRemoveId === policy.id
  const summary = formatPolicySummary(policy)
  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
        {summary}
      </div>
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Remove this rule?</span>
          <button
            className="btn btn-sm"
            style={{
              background: 'var(--status-blocked-bg)',
              color: 'var(--status-blocked-text)',
              border: '1px solid var(--status-blocked-border)',
            }}
            onClick={() => onRemove(policy)}
          >
            Yes
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onCancelRemove}>No</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
          <button className="btn btn-secondary btn-sm" onClick={onConfirmRemove}>Remove</button>
        </div>
      )}
    </div>
  )
}

interface LegacyRowProps {
  policy: Policy
  onEdit: () => void
  onConfirmRemove: () => void
  confirmRemoveId: string | null
  onCancelRemove: () => void
  onRemove: (p: Policy) => void
}

function LegacyRow({ policy, onEdit, onConfirmRemove, confirmRemoveId, onCancelRemove, onRemove }: LegacyRowProps) {
  const confirming = confirmRemoveId === policy.id
  return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 3 }}>
          {policy.policy_key.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {policy.policy_value}
        </div>
        {policy.description && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
            {policy.description}
          </div>
        )}
      </div>
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Remove this rule?</span>
          <button
            className="btn btn-sm"
            style={{
              background: 'var(--status-blocked-bg)',
              color: 'var(--status-blocked-text)',
              border: '1px solid var(--status-blocked-border)',
            }}
            onClick={() => onRemove(policy)}
          >
            Yes
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onCancelRemove}>No</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
          <button className="btn btn-secondary btn-sm" onClick={onConfirmRemove}>Remove</button>
        </div>
      )}
    </div>
  )
}
