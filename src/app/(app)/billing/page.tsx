'use client'
import { useCompany } from '@/lib/hooks/useCompany'
import { useQuria } from '@/lib/hooks/useQuria'
import type { BillingInfo } from '@/lib/types'

import { Suspense, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

type BillingState = BillingInfo & { name: string }

function formatISODate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active:   { label: 'Active',           color: 'var(--status-ready-text)',   bg: 'var(--status-ready-bg)',   border: 'var(--status-ready-border)' },
  inactive: { label: 'Inactive',         color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
  past_due: { label: 'Past Due',         color: 'var(--status-action-text)',  bg: 'var(--status-action-bg)',  border: 'var(--status-action-border)' },
  trialing: { label: 'Trial',            color: 'var(--status-review-text)',  bg: 'var(--status-review-bg)',  border: 'var(--status-review-border)' },
  canceled: { label: 'Canceled',         color: 'var(--status-blocked-text)', bg: 'var(--status-blocked-bg)', border: 'var(--status-blocked-border)' },
  paid:     { label: 'Payment Complete', color: 'var(--status-ready-text)',   bg: 'var(--status-ready-bg)',   border: 'var(--status-ready-border)' },
}

function BillingContent() {
  const { company } = useCompany()
  const { isQuria } = useQuria()
  const COMPANY_ID = company?.id ?? ''
  const [billing, setBilling] = useState<BillingState | null>(null)
  const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notesValue, setNotesValue] = useState('')
  const [priceValue, setPriceValue] = useState('')
  const [billingEmailValue, setBillingEmailValue] = useState('')
  const [savingAdmin, setSavingAdmin] = useState(false)
  const [adminSaved, setAdminSaved] = useState(false)

  // OPS-1 / BILL-1 — Quria-only company status controls. These call
  // /api/quria/company-gate rather than writing companies directly: that
  // route is the one place deactivated_at, service_through, and
  // billing_model are ever written from the app (see migration 021 and
  // the route's own header comment).
  const [billingModelValue, setBillingModelValue] = useState<'subscription' | 'one_time' | 'trial'>('one_time')
  const [serviceThroughValue, setServiceThroughValue] = useState('')
  const [gateLoading, setGateLoading] = useState(false)
  const [gateError, setGateError] = useState<string | null>(null)
  const [gateSaved, setGateSaved] = useState<string | null>(null)

  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

 useEffect(() => { if (COMPANY_ID) fetchData() }, [COMPANY_ID])

  async function fetchData() {
    if (!COMPANY_ID) return
    setLoading(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single()

    if (userData) setCurrentUser(userData)

    const { data: companyData } = await supabase
      .from('companies')
      .select('name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_price, subscription_notes, billing_email, subscription_period_end, cancel_at_period_end, billing_model, stripe_price_id, deactivated_at, service_through')
      .eq('id', COMPANY_ID)
      .single()

    if (companyData) {
      setBilling(companyData as BillingState)
      setNotesValue(companyData.subscription_notes ?? '')
      setPriceValue(String(companyData.subscription_price ?? 0))
      setBillingEmailValue(companyData.billing_email ?? '')
      setBillingModelValue((companyData.billing_model as 'subscription' | 'one_time' | 'trial' | null) ?? 'one_time')
      setServiceThroughValue(companyData.service_through ?? '')
    }

    setLoading(false)
  }

  // OPS-1: the one Quria-only surface for the kill switch and the two
  // Quria-set dates the gate reads (service_through covers both one_time
  // and trial models — there's one date field, not two, per Rule 0b).
  async function callCompanyGate(body: Record<string, unknown>, successMessage: string) {
    setGateLoading(true)
    setGateError(null)
    setGateSaved(null)
    try {
      const res = await fetch('/api/quria/company-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: COMPANY_ID, ...body }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setGateError(data.error ?? 'That action failed.')
        return
      }
      setGateSaved(successMessage)
      setTimeout(() => setGateSaved(null), 4000)
      await fetchData()
    } finally {
      setGateLoading(false)
    }
  }

  function handleDeactivate() {
    if (!window.confirm(`Deactivate ${billing?.name}? This immediately blocks their Homebase logins and stops all Aegis texts/emails for this company. Fully reversible.`)) return
    callCompanyGate({ action: 'deactivate' }, 'Deactivated — this company is now dark.')
  }
  function handleReactivate() {
    callCompanyGate({ action: 'reactivate' }, 'Reactivated — this company is live again.')
  }
  function handleSaveServiceThrough() {
    callCompanyGate(
      { action: 'set_service_through', service_through: serviceThroughValue || null },
      serviceThroughValue ? `Service-through date set to ${serviceThroughValue}.` : 'Service-through date cleared — no cap.',
    )
  }
  function handleSaveBillingModel() {
    callCompanyGate({ action: 'set_billing_model', billing_model: billingModelValue }, `Billing model set to ${billingModelValue}.`)
  }

  // Owner (or Quria) only — the server enforces it; the page just mirrors it.
  async function callBilling(action: 'start_checkout' | 'open_portal') {
    setActionLoading(true)
    setActionError(null)
    const res = await fetch('/api/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, company_id: COMPANY_ID }),
    })
    const data = (await res.json()) as { url?: string; error?: string }
    if (res.ok && data.url) {
      window.location.href = data.url
      return
    }
    setActionError(data.error ?? 'Billing action failed.')
    setActionLoading(false)
  }

  async function handleStartSubscription() {
    if (!billing) return
    await callBilling('start_checkout')
  }

  async function handleManageBilling() {
    if (!billing?.stripe_customer_id) return
    await callBilling('open_portal')
  }

  async function handleSaveAdmin() {
    setSavingAdmin(true)
    await supabase.from('companies').update({
      subscription_price: parseInt(priceValue) || 0,
      subscription_notes: notesValue.trim() || null,
      billing_email: billingEmailValue.trim() || null,
    }).eq('id', COMPANY_ID)
    setSavingAdmin(false)
    setAdminSaved(true)
    setTimeout(() => setAdminSaved(false), 3000)
    fetchData()
  }

  const canSeePricing = isQuria || currentUser?.role === 'owner' || currentUser?.role === 'manager'
  // Option A (Alexander, 2026-08-24): only the owner — or Quria — may start or manage the subscription.
  const canManageBilling = isQuria || currentUser?.role === 'owner'
  const statusInfo = STATUS_STYLES[billing?.subscription_status ?? 'inactive'] ?? STATUS_STYLES.inactive
  const success = searchParams.get('success')
  const cancelled = searchParams.get('cancelled')
  const isOneTime = billing?.billing_model === 'one_time'
  const isPaid = billing?.subscription_status === 'paid'

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading billing...
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Billing</div>
        <div className="page-subtitle">Subscription and payment management</div>
      </div>

      {success && (
        <div style={{
          background: 'var(--status-ready-bg)',
          border: '1px solid var(--status-ready-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--status-ready-text)',
          marginBottom: 24,
        }}>
          Payment successful. Your subscription is now active.
        </div>
      )}
      {cancelled && (
        <div style={{
          background: 'var(--status-action-bg)',
          border: '1px solid var(--status-action-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--status-action-text)',
          marginBottom: 24,
        }}>
          Checkout was cancelled. No payment was made.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>

        <div style={{
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 20 }}>
            Subscription
          </div>

<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              {canSeePricing && billing?.subscription_price ? (
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 6 }}>
                  {formatPrice(billing.subscription_price)}
                  {!isOneTime && (
                    <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>/month</span>
                  )}
                </div>
              ) : canSeePricing ? (
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--text-muted)', lineHeight: 1, marginBottom: 6 }}>
                  Not set
                  {!isOneTime && (
                    <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>/month</span>
                  )}
                </div>
              ) : null}
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Homebase + Aegis — {billing?.name}
              </div>
            </div>
            <span style={{
              padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 500,
              background: statusInfo.bg,
              color: statusInfo.color,
              border: `1px solid ${statusInfo.border}`,
            }}>
              {statusInfo.label}
            </span>
          </div>

          {isOneTime ? (
            isPaid ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                Your account is fully activated. Contact Quria Solutions for any billing questions.
              </div>
            ) : null
          ) : billing?.subscription_status === 'past_due' ? (
            <div style={{ fontSize: 12, color: 'var(--status-action-text)', marginBottom: 20 }}>
              Payment failed — update payment method to avoid cancellation
            </div>
          ) : billing?.cancel_at_period_end && billing?.subscription_period_end ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Access until: {formatISODate(billing.subscription_period_end)}
            </div>
          ) : billing?.subscription_status === 'active' && billing?.subscription_period_end ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Next billing date: {formatISODate(billing.subscription_period_end)}
            </div>
          ) : null}

          {canSeePricing && billing?.subscription_notes && billing.subscription_notes.trim() && (
            <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              <span style={{ color: 'var(--text-secondary)', fontStyle: 'normal' }}>Contract: </span>
              {billing.subscription_notes}
            </div>
          )}

          {canManageBilling ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {isOneTime ? (
                isPaid ? null : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleStartSubscription}
                    disabled={actionLoading || !billing?.subscription_price}
                  >
                    {actionLoading ? 'Loading...' : 'Complete Payment'}
                  </button>
                )
              ) : billing?.subscription_status !== 'active' ? (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleStartSubscription}
                  disabled={actionLoading || !billing?.subscription_price}
                >
                  {actionLoading ? 'Loading...' : 'Start Subscription'}
                </button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleManageBilling}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Loading...' : 'Manage Billing'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Only the account owner can start or change the subscription.
            </div>
          )}

          {actionError && (
            <div style={{ fontSize: 11, color: 'var(--danger, #c0392b)', marginTop: 10 }}>{actionError}</div>
          )}

          {!isQuria && !billing?.subscription_price && billing?.subscription_status !== 'active' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Subscription details are being configured by your Quria Solutions administrator.
            </div>
          )}
        </div>

        {isQuria && (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Quria Admin
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>— visible to you only</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Monthly Price (in cents)</label>
                <input
                  className="form-input"
                  type="number"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  placeholder="e.g. 50000 = $500.00"
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  {parseInt(priceValue) > 0 ? `= ${formatPrice(parseInt(priceValue))}/month` : 'Enter amount in cents'}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Billing Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={billingEmailValue}
                  onChange={(e) => setBillingEmailValue(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Contract Notes</label>
                <textarea
                  className="form-textarea"
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="e.g. 3-month trial at $400, increases to $500 in October."
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveAdmin}
                disabled={savingAdmin}
              >
                {savingAdmin ? 'Saving...' : 'Save'}
              </button>
              {adminSaved && (
                <span style={{ fontSize: 12, color: 'var(--status-ready-text)' }}>Saved</span>
              )}
            </div>

            {billing?.stripe_customer_id && (
              <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Stripe Customer: {billing.stripe_customer_id}
              </div>
            )}
            {billing?.stripe_subscription_id && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                Subscription: {billing.stripe_subscription_id}
              </div>
            )}
          </div>
        )}

        {isQuria && (
          <div style={{
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Company Status
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>— visible to you only</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              Controls whether {billing?.name ?? 'this company'} can use Homebase and Aegis at all.
              An owner can never flip their own company back on — only Quria staff can.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Billing Model</label>
                <select
                  className="form-input"
                  value={billingModelValue}
                  onChange={(e) => setBillingModelValue(e.target.value as 'subscription' | 'one_time' | 'trial')}
                >
                  <option value="subscription">Subscription (Stripe-managed)</option>
                  <option value="one_time">One-time (Quria sets the paid-through date)</option>
                  <option value="trial">Trial (no hard cap unless a date is set below)</option>
                </select>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSaveBillingModel}
                  disabled={gateLoading || billingModelValue === billing?.billing_model}
                  style={{ marginTop: 8 }}
                >
                  Save Billing Model
                </button>
              </div>

              {billingModelValue !== 'subscription' && (
                <div className="form-group">
                  <label className="form-label">Service Through Date</label>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Last day of service, in {billing?.name ?? 'the company'}&rsquo;s own timezone. Leave blank for no cap
                    (a trial with no date set never expires on its own).
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="form-input"
                      type="date"
                      value={serviceThroughValue}
                      onChange={(e) => setServiceThroughValue(e.target.value)}
                      style={{ maxWidth: 200 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleSaveServiceThrough}
                      disabled={gateLoading || serviceThroughValue === (billing?.service_through ?? '')}
                    >
                      Save Date
                    </button>
                  </div>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 14, marginTop: 4 }}>
                <label className="form-label">Kill Switch</label>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Overrides everything above immediately — no grace period. Fully reversible; nothing is deleted.
                </div>
                {billing?.deactivated_at ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 12,
                      fontWeight: 500,
                      background: 'var(--status-blocked-bg)',
                      color: 'var(--status-blocked-text)',
                      border: '1px solid var(--status-blocked-border)',
                    }}>
                      Deactivated {formatISODate(billing.deactivated_at)}
                    </span>
                    <button className="btn btn-primary btn-sm" onClick={handleReactivate} disabled={gateLoading}>
                      Reactivate
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={handleDeactivate} disabled={gateLoading}>
                    Deactivate This Company
                  </button>
                )}
              </div>
            </div>

            {gateError && (
              <div style={{ fontSize: 11, color: 'var(--danger, #c0392b)', marginTop: 14 }}>{gateError}</div>
            )}
            {gateSaved && (
              <div style={{ fontSize: 12, color: 'var(--status-ready-text)', marginTop: 14 }}>{gateSaved}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading billing...
      </div>
    }>
      <BillingContent />
    </Suspense>
  )
}