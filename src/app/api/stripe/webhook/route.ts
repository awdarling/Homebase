import Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Stripe API 2026-03-25 moved current_period_end onto subscription items.
// Fall back to the top-level field for older payloads.
function getPeriodEndISO(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined
  const unix =
    (subscription as unknown as { current_period_end?: number }).current_period_end ??
    item?.current_period_end ??
    null
  return unix ? new Date(unix * 1000).toISOString() : null
}

function resolveCustomerId(
  customer: string | { id: string } | null | undefined
): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[stripe-webhook] signature verification failed:', message)
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  console.log('[stripe-webhook] event:', event.type)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const customerId = resolveCustomerId(session.customer)
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null

        if (customerId && subscriptionId) {
          await adminSupabase
            .from('companies')
            .update({
              stripe_subscription_id: subscriptionId,
              subscription_status: 'active',
            })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = resolveCustomerId(subscription.customer)
        if (customerId) {
          await adminSupabase
            .from('companies')
            .update({
              stripe_subscription_id: subscription.id,
              subscription_status: subscription.status,
              subscription_period_end: getPeriodEndISO(subscription),
              cancel_at_period_end: subscription.cancel_at_period_end,
            })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = resolveCustomerId(subscription.customer)
        if (customerId) {
          await adminSupabase
            .from('companies')
            .update({
              subscription_status: subscription.status,
              subscription_period_end: getPeriodEndISO(subscription),
              cancel_at_period_end: subscription.cancel_at_period_end,
            })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = resolveCustomerId(subscription.customer)
        if (customerId) {
          await adminSupabase
            .from('companies')
            .update({
              subscription_status: 'canceled',
              cancel_at_period_end: false,
            })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = resolveCustomerId(invoice.customer)
        if (customerId) {
          await adminSupabase
            .from('companies')
            .update({ subscription_status: 'active' })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = resolveCustomerId(invoice.customer)
        if (customerId) {
          await adminSupabase
            .from('companies')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', customerId)
          console.log('[stripe-webhook] updated company for customer:', customerId)
        }
        break
      }

      default:
        // Unrecognized event — ack and move on.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[stripe-webhook] handler error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
