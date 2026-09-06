'use client'

import { Suspense, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

// BILL-1: the honest, state-specific page a manager/owner lands on when
// their company is dark (billing lapsed past grace, or Quria's OPS-1 kill
// switch). Deliberately NOT inside the (app) route group or its layout —
// this page must render correctly for a company with no live billing state
// to depend on. `/billing` stays reachable (middleware exempts it) so the
// owner can actually fix things; this page links there.
//
// Employee-facing SMS/email never sees this — Aegis's own neutral
// auto-reply (src/lib/company-gate.ts) never reveals billing status to
// staff. This page is for the manager/owner who can actually act on it.

type CompanyGateState = 'dark_kill_switch' | 'dark_lapsed' | string

interface CompanySummary {
  name: string
  billing_model: string | null
}

function copyFor(state: CompanyGateState, billingModel: string | null): { heading: string; body: string } {
  if (state === 'dark_kill_switch') {
    return {
      heading: 'Account paused',
      body: 'Your account has been paused by Quria Solutions. Contact your Quria Solutions representative for details.',
    }
  }
  if (billingModel === 'trial') {
    return {
      heading: 'Your trial has ended',
      body: "Your free trial of Aegis and Homebase has ended. Reach out to Quria Solutions to keep using them — we're happy to help you get set up.",
    }
  }
  if (billingModel === 'subscription') {
    return {
      heading: 'Subscription ended',
      body: 'Your subscription has ended. Visit Billing below to restart it, or contact Quria Solutions if you have questions.',
    }
  }
  // one_time, or an unrecognized model — the same neutral "service period"
  // wording, matching the kickoff's decision to treat one_time and any
  // unlabeled lapse the same way.
  return {
    heading: 'Service period ended',
    body: 'Your service period has ended. Contact Quria Solutions to renew, or visit Billing below for account details.',
  }
}

function ServicePausedContent() {
  const [company, setCompany] = useState<CompanySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const state = (searchParams.get('state') ?? 'dark_lapsed') as CompanyGateState

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: userRow } = await supabase.from('users').select('company_id').eq('id', user.id).maybeSingle()
      const companyId = (userRow as { company_id: string } | null)?.company_id
      if (!companyId) { setLoading(false); return }
      const { data: companyRow } = await supabase
        .from('companies')
        .select('name, billing_model')
        .eq('id', companyId)
        .maybeSingle()
      if (!cancelled) {
        setCompany(companyRow as CompanySummary | null)
        setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [supabase])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading...
      </div>
    )
  }

  const { heading, body } = copyFor(state, company?.billing_model ?? null)

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        maxWidth: 440,
        width: '100%',
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          {heading}
        </div>
        {company?.name && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            {company.name}
          </div>
        )}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
          {body}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={() => router.push('/billing')}>
            Go to Billing
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ServicePausedPage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading...
      </div>
    }>
      <ServicePausedContent />
    </Suspense>
  )
}
