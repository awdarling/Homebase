import Stripe from 'stripe'
import { NextRequest, NextResponse } from 'next/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body

    switch (action) {

      case 'create_customer': {
        const customer = await stripe.customers.create({
          email: params.email,
          name: params.name,
          metadata: { company_id: params.company_id },
        })
        return NextResponse.json({ customer_id: customer.id })
      }

      case 'create_checkout': {
        const session = await stripe.checkout.sessions.create({
          customer: params.customer_id,
          payment_method_types: ['card'],
          mode: 'subscription',
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: params.plan_name ?? 'Homebase + Aegis',
                description: params.plan_description ?? 'Monthly subscription to Quria Solutions',
              },
              unit_amount: params.amount_cents,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          }],
          success_url: `${params.origin}/billing?success=true`,
          cancel_url: `${params.origin}/billing?cancelled=true`,
        })
        return NextResponse.json({ url: session.url })
      }

      case 'create_portal': {
        const session = await stripe.billingPortal.sessions.create({
          customer: params.customer_id,
          return_url: `${params.origin}/billing`,
        })
        return NextResponse.json({ url: session.url })
      }

      case 'get_subscription': {
        if (!params.subscription_id) {
          return NextResponse.json({ status: 'inactive' })
        }
        const subscription = await stripe.subscriptions.retrieve(params.subscription_id)
        return NextResponse.json({
          status: subscription.status,
          current_period_end: subscription.current_period_end,
          cancel_at_period_end: subscription.cancel_at_period_end,
        })
      }

      case 'cancel_subscription': {
        await stripe.subscriptions.cancel(params.subscription_id)
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

  } catch (error: any) {
    console.error('Stripe error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}