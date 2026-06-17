'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/lib/hooks/useCompany'
import type { ShiftType, ShiftExperienceRule, ShiftExperienceRuleMode } from '@/lib/types'
import RulesModalShell from './RulesModalShell'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface FormState {
  shiftTypeId: string
  mode: ShiftExperienceRuleMode
  minCount: string
  role: string
  daysOfWeek: number[]
  seasonStart: string
  seasonEnd: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  shiftTypeId: '',
  mode: 'all_veterans',
  minCount: '2',
  role: '',
  daysOfWeek: [],
  seasonStart: '',
  seasonEnd: '',
  active: true,
}

function formatSeason(start: string | null, end: string | null): string {
  if (!start && !end) return 'year-round'
  const fmt = (d: string) => {
    // d is a YYYY-MM-DD date string; parse without timezone shift
    const [, m, day] = d.split('-').map((x) => parseInt(x, 10))
    const monthName = MONTHS[(m ?? 1) - 1] ?? '?'
    return `${monthName} ${day}`
  }
  if (start && end) return `${fmt(start)}–${fmt(end)}`
  if (start) return `from ${fmt(start)}`
  return `until ${fmt(end as string)}`
}

function formatDays(days: number[] | null): string {
  if (!days || days.length === 0) return 'every day'
  const sorted = [...days].sort((a, b) => a - b)
  return sorted.map((d) => DAY_LABELS_PLURAL[d] ?? `Day ${d}`).join(', ')
}

function formatRuleSummary(rule: ShiftExperienceRule, shiftName: string): string {
  const mode =
    rule.mode === 'all_veterans'
      ? 'all veterans'
      : `at least ${rule.min_count ?? '?'} veteran${(rule.min_count ?? 0) === 1 ? '' : 's'}`
  const roleSuffix = rule.role ? ` (${rule.role})` : ''
  return `${shiftName} — ${formatDays(rule.days_of_week)} — ${mode}${roleSuffix}`
}

interface Props {
  /** Optional overrides — defaults pull from useCompany + browser client. */
  companyId?: string
  supabase?: SupabaseClient
}

export default function ShiftVeteranRulesSection({ companyId, supabase: supabaseProp }: Props) {
  const { company, user } = useCompany()
  const supabase = useMemo(() => supabaseProp ?? createClient(), [supabaseProp])
  const COMPANY_ID = companyId ?? company?.id ?? ''

  const [rules, setRules] = useState<ShiftExperienceRule[]>([])
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftExperienceRule | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!COMPANY_ID) { setLoading(false); return }
    void fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COMPANY_ID])

  async function fetchData() {
    setLoading(true)
    const [rulesRes, stRes] = await Promise.all([
      supabase
        .from('shift_experience_rules')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('created_at', { ascending: false }),
      supabase
        .from('shift_types')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('name'),
    ])
    if (rulesRes.data) setRules(rulesRes.data as ShiftExperienceRule[])
    if (stRes.data) setShiftTypes(stRes.data as ShiftType[])
    setLoading(false)
  }

  const shiftNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const st of shiftTypes) m.set(st.id, st.name)
    return m
  }, [shiftTypes])

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, shiftTypeId: shiftTypes[0]?.id ?? '' })
    setError(null)
    setModalOpen(true)
  }

  function openEdit(rule: ShiftExperienceRule) {
    setEditing(rule)
    setForm({
      shiftTypeId: rule.shift_type_id,
      mode: rule.mode,
      minCount: rule.min_count != null ? String(rule.min_count) : '2',
      role: rule.role ?? '',
      daysOfWeek: rule.days_of_week ?? [],
      seasonStart: rule.season_start ?? '',
      seasonEnd: rule.season_end ?? '',
      active: rule.active,
    })
    setError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    setError(null)
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day)
        ? f.daysOfWeek.filter((d) => d !== day)
        : [...f.daysOfWeek, day].sort((a, b) => a - b),
    }))
  }

  const canSave =
    !!form.shiftTypeId &&
    (form.mode !== 'min_veterans' || (parseInt(form.minCount, 10) || 0) >= 1)

  async function handleSave() {
    if (!form.shiftTypeId) { setError('Pick a shift.'); return }
    let minCount: number | null = null
    if (form.mode === 'min_veterans') {
      const n = parseInt(form.minCount, 10)
      if (isNaN(n) || n < 1) { setError('Enter a minimum of at least 1 veteran.'); return }
      minCount = n
    }
    setSaving(true)
    setError(null)

    const payload = {
      shift_type_id: form.shiftTypeId,
      days_of_week: form.daysOfWeek.length > 0 ? form.daysOfWeek : null,
      role: form.role.trim() ? form.role.trim() : null,
      mode: form.mode,
      min_count: minCount,
      season_start: form.seasonStart || null,
      season_end: form.seasonEnd || null,
      active: form.active,
    }

    try {
      if (editing) {
        const { error: upErr } = await supabase
          .from('shift_experience_rules')
          .update(payload)
          .eq('id', editing.id)
        if (upErr) throw upErr
      } else {
        const { error: insErr } = await supabase
          .from('shift_experience_rules')
          .insert({
            company_id: COMPANY_ID,
            created_by: user?.name || 'manager',
            ...payload,
          })
        if (insErr) throw insErr
      }
      closeModal()
      await fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('shift_experience_rules').delete().eq('id', id)
    setConfirmDeleteId(null)
    await fetchData()
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
          Shift veteran rules
        </h2>
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          + Add shift veteran rule
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Require veterans on specific shifts — for all positions, or a minimum count — optionally scoped to certain days, a role, or a season.
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
          Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px dashed var(--border-default)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          fontSize: 12,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          No shift veteran rules yet. Add one to require veterans on a shift.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((rule) => {
            const shiftName = shiftNameById.get(rule.shift_type_id) ?? 'Unknown shift'
            const confirming = confirmDeleteId === rule.id
            return (
              <div
                key={rule.id}
                style={{
                  background: 'var(--bg-surface-1)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    {formatRuleSummary(rule, shiftName)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{formatSeason(rule.season_start, rule.season_end)}</span>
                    <span style={{ color: 'var(--border-default)' }}>·</span>
                    <span style={{ color: rule.active ? 'var(--accent)' : 'var(--text-disabled)' }}>
                      {rule.active ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                </div>
                {confirming ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Delete this rule?</span>
                    <button
                      className="btn btn-sm"
                      style={{
                        background: 'var(--status-blocked-bg)',
                        color: 'var(--status-blocked-text)',
                        border: '1px solid var(--status-blocked-border)',
                      }}
                      onClick={() => handleDelete(rule.id)}
                    >
                      Yes
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(null)}>No</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(rule)}>Edit</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(rule.id)}>Delete</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <RulesModalShell
          open={modalOpen}
          title={editing ? 'Edit shift veteran rule' : 'Add shift veteran rule'}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
          canSave={canSave}
          error={error}
        >
          <div className="form-group">
            <label className="form-label">Shift</label>
            {shiftTypes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--status-blocked-text)' }}>
                No shift types defined yet. Add shift types under Data first.
              </div>
            ) : (
              <select
                className="form-select"
                value={form.shiftTypeId}
                onChange={(e) => setForm((f) => ({ ...f, shiftTypeId: e.target.value }))}
              >
                <option value="">Select a shift…</option>
                {shiftTypes.map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Requirement</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="veteran-mode"
                  checked={form.mode === 'all_veterans'}
                  onChange={() => setForm((f) => ({ ...f, mode: 'all_veterans' }))}
                />
                All veterans
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="veteran-mode"
                  checked={form.mode === 'min_veterans'}
                  onChange={() => setForm((f) => ({ ...f, mode: 'min_veterans' }))}
                />
                At least
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  step={1}
                  value={form.minCount}
                  disabled={form.mode !== 'min_veterans'}
                  onChange={(e) => setForm((f) => ({ ...f, minCount: e.target.value }))}
                  style={{ width: 64, opacity: form.mode === 'min_veterans' ? 1 : 0.5 }}
                />
                veterans
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Role (optional)</label>
            <input
              className="form-input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              placeholder="Leave blank for any role on the shift"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Days</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                    cursor: 'pointer',
                    background: form.daysOfWeek.includes(i) ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                    borderColor: form.daysOfWeek.includes(i) ? 'var(--accent-border)' : 'var(--border-default)',
                    color: form.daysOfWeek.includes(i) ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              None selected = applies every day.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Season (optional)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Start</div>
                <input
                  className="form-input"
                  type="date"
                  value={form.seasonStart}
                  onChange={(e) => setForm((f) => ({ ...f, seasonStart: e.target.value }))}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>End</div>
                <input
                  className="form-input"
                  type="date"
                  value={form.seasonEnd}
                  onChange={(e) => setForm((f) => ({ ...f, seasonEnd: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Leave both blank for year-round.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Status</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {(['Active', 'Inactive'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, active: s === 'Active' }))}
                  style={{
                    padding: '5px 16px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                    cursor: 'pointer',
                    background: (s === 'Active') === form.active ? 'var(--accent-dim)' : 'var(--bg-surface-3)',
                    borderColor: (s === 'Active') === form.active ? 'var(--accent-border)' : 'var(--border-default)',
                    color: (s === 'Active') === form.active ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </RulesModalShell>
      )}
    </section>
  )
}
