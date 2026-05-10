'use client'

import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Local types ──────────────────────────────────────────────────────────────

interface PayrollDiscrepancy {
  employee_name: string
  type: string
  scheduled_hours?: number
  actual_hours?: number
  note?: string
}

interface PayrollCheckMeta {
  pay_period_start?: string
  pay_period_end?: string
  total_employees?: number
  clean_count?: number
  issue_count?: number
  discrepancies?: PayrollDiscrepancy[]
  hour_variance?: number
  wage_variance?: number
}

interface ActivityEntry {
  id: string
  actor: string
  action: string
  summary: string
  metadata: Record<string, unknown> | null
  created_at: string
}

interface TimeClockForm {
  provider: 'northstar' | 'manual'
  api_base_url: string
  api_key: string
  location_id: string
  active: boolean
}

interface PayrollProviderForm {
  provider: 'axios_engage' | 'manual'
  api_key: string
  company_identifier: string
  pay_period: 'weekly' | 'biweekly' | 'semimonthly'
  payroll_check_day: number
  auto_check_enabled: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'history',  label: 'History' },
  { id: 'settings', label: 'Settings' },
]

const PAYROLL_ACTIONS = ['payroll_check_complete', 'payroll_check_clean', 'payroll_check_issues']

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DISCREPANCY_STYLES: Record<string, { label: string; bg: string; color: string; border: string }> = {
  no_show:           { label: 'No Show',           bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', border: 'rgba(239,68,68,0.25)' },
  forgot_clock_out:  { label: 'Forgot Clock Out',  bg: 'rgba(249,115,22,0.1)', color: '#f97316', border: 'rgba(249,115,22,0.25)' },
  early_clock_in:    { label: 'Early Clock In',    bg: 'rgba(234,179,8,0.1)',  color: '#ca8a04', border: 'rgba(234,179,8,0.25)' },
  late_clock_in:     { label: 'Late Clock In',     bg: 'rgba(234,179,8,0.1)',  color: '#ca8a04', border: 'rgba(234,179,8,0.25)' },
  early_clock_out:   { label: 'Early Clock Out',   bg: 'rgba(234,179,8,0.1)',  color: '#ca8a04', border: 'rgba(234,179,8,0.25)' },
  late_clock_out:    { label: 'Late Clock Out',    bg: 'rgba(234,179,8,0.1)',  color: '#ca8a04', border: 'rgba(234,179,8,0.25)' },
  unscheduled_shift: { label: 'Unscheduled Shift', bg: 'rgba(168,85,247,0.1)', color: '#a855f7', border: 'rgba(168,85,247,0.25)' },
  clean:             { label: 'Clean',             bg: 'rgba(34,197,94,0.1)',  color: '#16a34a', border: 'rgba(34,197,94,0.25)' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(s: string) {
  return new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMonth(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatTime(s: string) {
  return new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function getMonthKey(s: string) {
  const d = new Date(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseMeta(entry: ActivityEntry): PayrollCheckMeta {
  return (entry.metadata ?? {}) as PayrollCheckMeta
}

// ─── Shared components ────────────────────────────────────────────────────────

function DiscrepancyBadge({ type }: { type: string }) {
  const s = DISCREPANCY_STYLES[type] ?? {
    label: type.replace(/_/g, ' '),
    bg: 'var(--bg-surface-3)',
    color: 'var(--text-muted)',
    border: 'var(--border-default)',
  }
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--bg-surface-3)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: 'white',
        transition: 'left 0.2s',
        display: 'block',
      }} />
    </button>
  )
}

function InlineResult({ result }: { result: { success: boolean; message: string } | null }) {
  if (!result) return null
  return (
    <div style={{ fontSize: 12, color: result.success ? '#16a34a' : '#ef4444', lineHeight: 1.5 }}>
      {result.message}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ companyId }: { companyId: string }) {
  const [entry, setEntry] = useState<ActivityEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('activity_log')
        .select('*')
        .eq('company_id', companyId)
        .in('action', PAYROLL_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(1)
      setEntry(data?.[0] ?? null)
      setLoading(false)
    }
    if (companyId) load()
  }, [companyId])

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading...
    </div>
  )

  if (!entry) return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
      padding: '56px 32px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, maxWidth: 400, margin: '0 auto' }}>
        No payroll checks run yet. Configure your integration in Settings and ask Aegis to run a payroll check, or enable auto-check.
      </div>
    </div>
  )

  const meta = parseMeta(entry)
  const isClean = entry.action === 'payroll_check_clean' || (meta.issue_count ?? 0) === 0
  const discrepancies = meta.discrepancies ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary card */}
      <div style={{
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Last Run</div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{formatDateTime(entry.created_at)}</div>
            </div>
            {meta.pay_period_start && meta.pay_period_end && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Pay Period</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {formatDate(meta.pay_period_start)} – {formatDate(meta.pay_period_end)}
                </div>
              </div>
            )}
          </div>
          <div style={{
            padding: '5px 14px',
            borderRadius: 'var(--radius-pill)',
            background: isClean ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${isClean ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
            fontSize: 12,
            fontWeight: 600,
            color: isClean ? '#16a34a' : '#ef4444',
            flexShrink: 0,
          }}>
            {isClean ? 'All Clear' : `${meta.issue_count ?? discrepancies.length} Issue${(meta.issue_count ?? discrepancies.length) !== 1 ? 's' : ''} Found`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {meta.total_employees != null && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Total Employees</div>
              <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{meta.total_employees}</div>
            </div>
          )}
          {meta.clean_count != null && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Clean</div>
              <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 700, color: '#16a34a' }}>{meta.clean_count}</div>
            </div>
          )}
          {meta.issue_count != null && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Issues</div>
              <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 700, color: meta.issue_count > 0 ? '#ef4444' : '#16a34a' }}>{meta.issue_count}</div>
            </div>
          )}
        </div>
      </div>

      {/* Clean state */}
      {isClean && discrepancies.length === 0 && (
        <div style={{
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px 24px',
          textAlign: 'center',
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(34,197,94,0.15)',
            border: '1px solid rgba(34,197,94,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
            fontSize: 18,
            color: '#16a34a',
          }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#16a34a', marginBottom: 6 }}>Payroll is clean</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            All employee time records matched their scheduled shifts. No discrepancies found.
          </div>
        </div>
      )}

      {/* Discrepancy cards */}
      {discrepancies.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>Discrepancies</div>
          {discrepancies.map((d, i) => (
            <div key={i} style={{
              background: 'var(--bg-surface-1)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{d.employee_name}</span>
                  <DiscrepancyBadge type={d.type} />
                </div>
                {d.note && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{d.note}</div>
                )}
              </div>
              {(d.scheduled_hours != null || d.actual_hours != null) && (
                <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
                  {d.scheduled_hours != null && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Scheduled</div>
                      <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-secondary)' }}>{d.scheduled_hours}h</div>
                    </div>
                  )}
                  {d.actual_hours != null && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Actual</div>
                      <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{d.actual_hours}h</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('activity_log')
        .select('*')
        .eq('company_id', companyId)
        .in('action', PAYROLL_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(100)
      if (data) setEntries(data)
      setLoading(false)
    }
    if (companyId) load()
  }, [companyId])

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading history...
    </div>
  )

  if (entries.length === 0) return (
    <div style={{
      background: 'var(--bg-surface-1)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div className="empty-state">
        <div className="empty-state-title">No payroll history yet</div>
        <div className="empty-state-desc">Payroll check results will appear here after Aegis runs a check.</div>
      </div>
    </div>
  )

  const grouped = entries.reduce((acc, entry) => {
    const key = getMonthKey(entry.created_at)
    if (!acc[key]) acc[key] = []
    acc[key].push(entry)
    return acc
  }, {} as Record<string, ActivityEntry[]>)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {Object.entries(grouped).map(([monthKey, monthEntries]) => (
        <div key={monthKey}>
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            {formatMonth(monthEntries[0].created_at)}
            <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          </div>

          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            {monthEntries.map((entry, i) => {
              const meta = parseMeta(entry)
              const isClean = entry.action === 'payroll_check_clean' || (meta.issue_count ?? 0) === 0
              const issueCount = meta.issue_count ?? 0

              return (
                <div key={entry.id} style={{
                  padding: '16px 20px',
                  borderBottom: i < monthEntries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        background: isClean ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        color: isClean ? '#16a34a' : '#ef4444',
                        border: `1px solid ${isClean ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                        {isClean ? 'Clean' : `${issueCount} Issue${issueCount !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {entry.summary}
                    </div>
                    {meta.pay_period_start && meta.pay_period_end && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                        Pay period: {formatDate(meta.pay_period_start)} – {formatDate(meta.pay_period_end)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span>{formatDate(entry.created_at)}</span>
                      <span>·</span>
                      <span>{formatTime(entry.created_at)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 20, flexShrink: 0, flexWrap: 'wrap' }}>
                    {meta.total_employees != null && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Employees</div>
                        <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{meta.total_employees}</div>
                      </div>
                    )}
                    {meta.hour_variance != null && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Hour Δ</div>
                        <div style={{
                          fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 700,
                          color: meta.hour_variance === 0 ? '#16a34a' : meta.hour_variance > 0 ? '#f97316' : '#ef4444',
                        }}>
                          {meta.hour_variance > 0 ? '+' : ''}{meta.hour_variance}h
                        </div>
                      </div>
                    )}
                    {meta.wage_variance != null && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Wage Δ</div>
                        <div style={{
                          fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 700,
                          color: meta.wage_variance === 0 ? '#16a34a' : '#f97316',
                        }}>
                          {meta.wage_variance > 0 ? '+' : '-'}${Math.abs(meta.wage_variance).toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ companyId, isQuria }: { companyId: string; isQuria: boolean }) {
  const supabase = createClient()

  // Time Clock
  const [tcLoading, setTcLoading] = useState(true)
  const [tcSaving, setTcSaving] = useState(false)
  const [tcTesting, setTcTesting] = useState(false)
  const [tcTestResult, setTcTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [tcSaveResult, setTcSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [tcForm, setTcForm] = useState<TimeClockForm>({
    provider: 'northstar',
    api_base_url: '',
    api_key: '',
    location_id: '',
    active: true,
  })

  // Payroll Provider
  const [prLoading, setPrLoading] = useState(true)
  const [prSaving, setPrSaving] = useState(false)
  const [prTesting, setPrTesting] = useState(false)
  const [prTestResult, setPrTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [prSaveResult, setPrSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [prLastRun, setPrLastRun] = useState<string | null>(null)
  const [prForm, setPrForm] = useState<PayrollProviderForm>({
    provider: 'axios_engage',
    api_key: '',
    company_identifier: '',
    pay_period: 'biweekly',
    payroll_check_day: 1,
    auto_check_enabled: false,
  })

  useEffect(() => {
    if (!companyId) return
    loadTimeClock()
    loadPayrollProvider()
  }, [companyId])

  async function loadTimeClock() {
    setTcLoading(true)
    const { data } = await supabase
      .from('time_clock_integrations')
      .select('*')
      .eq('company_id', companyId)
      .limit(1)
    const row = data?.[0]
    if (row) {
      setTcForm({
        provider: row.provider ?? 'northstar',
        api_base_url: row.api_base_url ?? '',
        api_key: row.api_key ?? '',
        location_id: row.location_id ?? '',
        active: row.active ?? true,
      })
    }
    setTcLoading(false)
  }

  async function loadPayrollProvider() {
    setPrLoading(true)
    const { data } = await supabase
      .from('payroll_integrations')
      .select('*')
      .eq('company_id', companyId)
      .limit(1)
    const row = data?.[0]
    if (row) {
      setPrForm({
        provider: row.provider ?? 'axios_engage',
        api_key: row.api_key ?? '',
        company_identifier: row.company_identifier ?? '',
        pay_period: row.pay_period ?? 'biweekly',
        payroll_check_day: row.payroll_check_day ?? 1,
        auto_check_enabled: row.auto_check_enabled ?? false,
      })
      setPrLastRun(row.last_run_at ?? null)
    }
    setPrLoading(false)
  }

  async function saveTimeClock() {
    setTcSaving(true)
    setTcSaveResult(null)
    const { error } = await supabase
      .from('time_clock_integrations')
      .upsert({
        company_id: companyId,
        provider: tcForm.provider,
        api_base_url: tcForm.api_base_url || null,
        api_key: tcForm.api_key || null,
        location_id: tcForm.location_id || null,
        active: tcForm.active,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })
    setTcSaveResult(error
      ? { success: false, message: error.message }
      : { success: true, message: 'Settings saved.' }
    )
    setTcSaving(false)
  }

  async function savePayrollProvider() {
    setPrSaving(true)
    setPrSaveResult(null)
    const { error } = await supabase
      .from('payroll_integrations')
      .upsert({
        company_id: companyId,
        provider: prForm.provider,
        api_key: prForm.api_key || null,
        company_identifier: prForm.company_identifier || null,
        pay_period: prForm.pay_period,
        payroll_check_day: prForm.payroll_check_day,
        auto_check_enabled: prForm.auto_check_enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' })
    setPrSaveResult(error
      ? { success: false, message: error.message }
      : { success: true, message: 'Settings saved.' }
    )
    setPrSaving(false)
  }

  async function testTimeClock() {
    setTcTesting(true)
    setTcTestResult(null)
    try {
      const res = await fetch('/api/payroll/test-timeclock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      setTcTestResult(await res.json())
    } catch {
      setTcTestResult({ success: false, message: 'Request failed.' })
    }
    setTcTesting(false)
  }

  async function testPayrollProvider() {
    setPrTesting(true)
    setPrTestResult(null)
    try {
      const res = await fetch('/api/payroll/test-payroll-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      })
      setPrTestResult(await res.json())
    } catch {
      setPrTestResult({ success: false, message: 'Request failed.' })
    }
    setPrTesting(false)
  }

  const cardStyle = {
    background: 'var(--bg-surface-1)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  }

  const cardHeaderStyle = {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-subtle)',
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 20,
      alignItems: 'start',
    }}>
      {/* Card 1: Time Clock */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>Time Clock</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Configure the time clock system Aegis reads punch data from</div>
        </div>

        {tcLoading ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select
                className="form-select"
                value={tcForm.provider}
                onChange={e => setTcForm(f => ({ ...f, provider: e.target.value as TimeClockForm['provider'] }))}
              >
                <option value="northstar">NorthStar</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">API Base URL</label>
              <input
                className="form-input"
                value={tcForm.api_base_url}
                onChange={e => setTcForm(f => ({ ...f, api_base_url: e.target.value }))}
                placeholder="https://api.northstar.com/v1"
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Base URL for NorthStar API — no trailing slash
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                className="form-input"
                type={isQuria ? 'text' : 'password'}
                value={tcForm.api_key}
                onChange={e => setTcForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder="Your NorthStar API key"
              />
              {!isQuria && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Contact Quria to view
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Location ID</label>
              <input
                className="form-input"
                value={tcForm.location_id}
                onChange={e => setTcForm(f => ({ ...f, location_id: e.target.value }))}
                placeholder="Your NorthStar location ID"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Toggle checked={tcForm.active} onChange={v => setTcForm(f => ({ ...f, active: v }))} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Active</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Verify credentials are saved. Live connection is tested when Aegis runs a payroll check.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={testTimeClock} disabled={tcTesting}>
                  {tcTesting ? 'Checking...' : 'Test Connection'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={saveTimeClock} disabled={tcSaving}>
                  {tcSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <InlineResult result={tcTestResult} />
              <InlineResult result={tcSaveResult} />
            </div>
          </div>
        )}
      </div>

      {/* Card 2: Payroll Provider */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>Payroll Provider</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Configure the payroll system Aegis reconciles against</div>
        </div>

        {prLoading ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select
                className="form-select"
                value={prForm.provider}
                onChange={e => setPrForm(f => ({ ...f, provider: e.target.value as PayrollProviderForm['provider'] }))}
              >
                <option value="axios_engage">Axios Engage</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                className="form-input"
                type={isQuria ? 'text' : 'password'}
                value={prForm.api_key}
                onChange={e => setPrForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder="Your Engage API key"
              />
              {!isQuria && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Contact Quria to view
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Company Identifier</label>
              <input
                className="form-input"
                value={prForm.company_identifier}
                onChange={e => setPrForm(f => ({ ...f, company_identifier: e.target.value }))}
                placeholder="Your company ID in Engage"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Pay Period</label>
              <select
                className="form-select"
                value={prForm.pay_period}
                onChange={e => setPrForm(f => ({ ...f, pay_period: e.target.value as PayrollProviderForm['pay_period'] }))}
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semimonthly">Semimonthly</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Payroll Check Day</label>
              <select
                className="form-select"
                value={prForm.payroll_check_day}
                onChange={e => setPrForm(f => ({ ...f, payroll_check_day: Number(e.target.value) }))}
              >
                {DAYS.map((day, i) => (
                  <option key={i} value={i}>{day}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ paddingTop: 2 }}>
                <Toggle checked={prForm.auto_check_enabled} onChange={v => setPrForm(f => ({ ...f, auto_check_enabled: v }))} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Auto-check enabled</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
                  Aegis will automatically run a payroll check on the selected day each pay period
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Last run: </span>
              {prLastRun ? formatDateTime(prLastRun) : 'Never'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Verify credentials are saved. Live connection is tested when Aegis runs a payroll check.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={testPayrollProvider} disabled={prTesting}>
                  {prTesting ? 'Checking...' : 'Test Connection'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={savePayrollProvider} disabled={prSaving}>
                  {prSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <InlineResult result={prTestResult} />
              <InlineResult result={prSaveResult} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { company } = useCompany()
  const { isQuria, loading: quriaLoading, debug: quriaDebug } = useQuria()
  const companyId = company?.id ?? ''
  const [activeTab, setActiveTab] = useState('overview')

  // While loading, isQuria is false — Settings tab stays hidden (safe default).
  const visibleTabs = TABS.filter(tab => tab.id !== 'settings' || isQuria)

  useEffect(() => {
    if (!quriaLoading && !isQuria && activeTab === 'settings') {
      setActiveTab('overview')
    }
  }, [quriaLoading, isQuria, activeTab])

  useEffect(() => {
    async function verify() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('quria_staff')
        .select('email, active')
        .in('email', ['xander.w.darling@gmail.com', 'awdarling@quriasolutions.com'])
      console.log('[payroll] quria_staff verify:', { data, error: error?.message })
    }
    verify()
  }, [])

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Payroll</div>
        <div className="page-subtitle">
          Time clock reconciliation and payroll integration — powered by Aegis
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 2,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 24,
      }}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              color: activeTab === tab.id
                ? 'var(--text-primary)'
                : 'var(--text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 500 : 400,
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!isQuria && (
        <div style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          marginBottom: 16,
          opacity: 0.6,
        }}>
          [debug] isQuria: {String(isQuria)}, loading: {String(quriaLoading)}, email: {quriaDebug?.email ?? '—'}, rowFound: {String(quriaDebug?.rowFound ?? false)}{quriaDebug?.error ? `, error: ${quriaDebug.error}` : ''}
        </div>
      )}

      {companyId ? (
        <>
          {activeTab === 'overview' && <OverviewTab companyId={companyId} />}
          {activeTab === 'history'  && <HistoryTab  companyId={companyId} />}
          {activeTab === 'settings' && <SettingsTab companyId={companyId} isQuria={isQuria} />}
        </>
      ) : (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading...
        </div>
      )}
    </div>
  )
}
