import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCompanyLiveStatus, type CompanyBillingFields } from './lib/company-status'

// Paths that must stay reachable even when a company is dark. `/billing` so
// the owner can actually fix it (a gate that blocks the page needed to pay
// is a trap — kickoff prompt, BILL-1), `/api/stripe` because the billing
// page's own "Start Subscription" / "Manage Billing" actions POST there,
// `/service-paused` so the block page itself doesn't redirect to itself,
// and `/api/quria` so the Quria admin panel's own writes (the kill switch,
// setting service_through) work from a dark company's billing page too.
function isGateExempt(pathname: string): boolean {
  return (
    pathname.startsWith('/billing') ||
    pathname.startsWith('/api/stripe') ||
    pathname.startsWith('/api/quria') ||
    pathname.startsWith('/service-paused')
  )
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request: { headers: request.headers },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Record<string, unknown>)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/reset-password') ||
    pathname === '/api/aegis-action' ||
    pathname === '/api/stripe/webhook'

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user) {
    // Revoked-access lockout: a revoked user keeps their login account (so we
    // can recognize them) but is blocked from every page and routed to the
    // login screen with a clear "access removed" message.
    const { data: profile } = await supabase
      .from('users')
      .select('access_revoked_at, company_id, role')
      .eq('id', user.id)
      .maybeSingle()
    const typedProfile = profile as { access_revoked_at: string | null; company_id: string | null; role: string | null } | null
    const revoked = !!typedProfile?.access_revoked_at

    if (revoked) {
      // Let them land on /login to read the message; block everything else.
      if (pathname.startsWith('/login')) return response
      return NextResponse.redirect(new URL('/login?revoked=1', request.url))
    }

    // An active user shouldn't sit on the login page.
    if (pathname.startsWith('/login')) {
      return NextResponse.redirect(new URL('/', request.url))
    }

    // BILL-1/OPS-1: block a dark company's logins with an honest,
    // state-specific page — never a generic 403, never a silent login loop.
    // Quria staff are exempt (get_my_role() = 'quria' is the same convention
    // the RLS policies already use) — they're the ones who need to reach a
    // dark company's Homebase to fix or review it, and OPS-1 already
    // requires that only Quria (never the owner) can flip the switch back.
    const isQuria = typedProfile?.role === 'quria'
    if (!isQuria && typedProfile?.company_id && !isGateExempt(pathname)) {
      const { data: companyRow } = await supabase
        .from('companies')
        .select('billing_model, subscription_period_end, service_through, deactivated_at, timezone')
        .eq('id', typedProfile.company_id)
        .maybeSingle()

      if (companyRow) {
        const gate = getCompanyLiveStatus(companyRow as CompanyBillingFields, new Date())
        if (!gate.live) {
          const url = new URL('/service-paused', request.url)
          url.searchParams.set('state', gate.state)
          return NextResponse.redirect(url)
        }
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
