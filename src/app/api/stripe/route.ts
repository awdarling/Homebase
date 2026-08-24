/*
 * Billing actions — S-2 (SECURITY_AUDIT_MASTER §1), rewritten 2026-08-24.
 *
 * Decision (Alexander, 2026-08-24, Option A): Quria sets the price on the
 * company record; the company's OWNER login (and only the owner — or Quria)
 * starts the subscription and manages it, including cancel-at-period-end via
 * the Stripe portal. Managers see the status and nothing else.
 *
 * Before this rewrite the route had no login check, no company check, and took
 * the PRICE from the request body. Now:
 *   - the caller must be signed in, and be `owner` or `quria`
 *   - the company is the caller's own (quria may name one)
 *   - price, billing model, Stripe ids all come from `companies` — never the body
 *   - the Stripe customer id is persisted here, server-side, not by the browser
 *
 * Actions: start_checkout | open_portal | get_subscription
 * (`cancel_subscription` — immediate cancel — is removed: it contradicted the
 * "service to the end of the paid period" decision; the portal does it right.)
 */

import Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BILLING_ROLES = ['owner', 'quria'] as const

type CompanyBilling = {
  id: string
  name: string
  billing_email: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_price: number | null
  billing_model: 'subscription' | 'one_time' | null
  stripe_price_id: string | null
}

async function authorize(req: NextRequest, requestedCompanyId: string | undefined) {
  const ssr = await createServerSupabase()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const { data: callerRow } = await ssr
    .from('users')
    .select('role, company_id')
    .eq('id', user.id)
    .single()
  const caller = callerRow as { role: string; company_id: string } | null
  if (!caller) return { ok: false as const, status: 403, error: 'Forbidden' }

  if (!(BILLING_ROLES as readonly string[]).includes(caller.role)) {
    return { ok: false as const, status: 403, error: 'Only the account owner can manage billing.' }
  }

  const companyId = caller.role === 'quria' && requestedCompanyId ? requestedCompanyId : caller.company_id
  if (!companyId) return { ok: false as const, status: 400, error: 'No company for this login.' }

  const { data: companyRow } = await admin
    .from('companies')
    .select('id, name, billing_email, stripe_customer_id, stripe_subscription_id, subscription_price, billing_model, stripe_price_id')
    .eq('id', companyId)
    .maybeSingle()
  const company = companyRow as CompanyBilling | null
  if (!company) return { ok: false as const, status: 404, error: 'Company not found.' }

  return { ok: true as const, company, callerRole: caller.role }
}

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
}

export async function POST(req: NextRequest) {
  let body: { action?: string; company_id?: string }
  try {
    body = (await req.json()) as { action?: string; company_id?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const auth = await authorize(req, body.company_id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { company } = auth
  const origin = appOrigin(req)

  try {
    switch (body.action) {
      case 'start_checkout': {
        // Price is the one Quria set on the company — never from the caller.
        const amountCents = company.subscription_price ?? 0
        if (!company.stripe_price_id && amountCents <= 0) {
          return NextResponse.json({ error: 'No price has been configured for this company yet.' }, { status: 409 })
        }

        let customerId = company.stripe_customer_id
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: company.billing_email ?? undefined,
            name: company.name,
            metadata: { company_id: company.id },
          })
          customerId = customer.id
          const { error } = await admin
            .from('companies')
            .update({ stripe_customer_id: customerId })
            .eq('id', company.id)
          if (error) throw new Error('Could not save Stripe customer id')
        }

        const mode = company.billing_model === 'one_time' ? 'payment' : 'subscription'
        const lineItem = company.stripe_price_id
          ? { price: company.stripe_price_id, quantity: 1 }
          : {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: 'Homebase + Aegis',
                  description: `Monthly subscription — ${company.name}`,
                },
                unit_amount: amountCents,
                ...(mode === 'subscription' && { recurring: { interval: 'month' as const } }),
              },
              quantity: 1,
            }

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ['card'],
          mode,
          line_items: [lineItem],
          metadata: { company_id: company.id },
          success_url: `${origin}/billing?success=true`,
          cancel_url: `${origin}/billing?cancelled=true`,
        })
        return NextResponse.json({ url: session.url })
      }

      case 'open_portal': {
        if (!company.stripe_customer_id) {
          return NextResponse.json({ error: 'No billing account exists for this company yet.' }, { status: 409 })
        }
        const session = await stripe.billingPortal.sessions.create({
          customer: company.stripe_customer_id,
          return_url: `${origin}/billing`,
        })
        return NextResponse.json({ url: session.url })
      }

      case 'get_subscription': {
        if (!company.stripe_subscription_id) return NextResponse.json({ status: 'inactive' })
        const subscription = await stripe.subscriptions.retrieve(company.stripe_subscription_id)
        const item = subscription.items?.data?.[0]
        const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end ?? null
        return NextResponse.json({
          status: subscription.status,
          current_period_end: periodEnd,
          cancel_at_period_end: subscription.cancel_at_period_end,
        })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    // Detail stays in the server log (N-8); the browser gets a generic message.
    console.error('[stripe] action failed:', body.action, error)
    return NextResponse.json({ error: 'Billing action failed. Please try again or contact Quria Solutions.' }, { status: 500 })
  }
}
