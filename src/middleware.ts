import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
      .select('access_revoked_at')
      .eq('id', user.id)
      .maybeSingle()
    const revoked = !!(profile as { access_revoked_at: string | null } | null)?.access_revoked_at

    if (revoked) {
      // Let them land on /login to read the message; block everything else.
      if (pathname.startsWith('/login')) return response
      return NextResponse.redirect(new URL('/login?revoked=1', request.url))
    }

    // An active user shouldn't sit on the login page.
    if (pathname.startsWith('/login')) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}