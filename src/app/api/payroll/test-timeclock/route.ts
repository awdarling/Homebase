import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { company_id } = body

    if (!company_id) {
      return NextResponse.json({ success: false, message: 'company_id is required.' }, { status: 400 })
    }

    // Standard auth guard: caller must be signed in and belong to the company they query.
    const ssr = await createServerSupabase()
    const { data: { user } } = await ssr.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
    }
    const { data: userRow } = await ssr
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single()
    if (!userRow || (userRow as { company_id: string }).company_id !== company_id) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }

    const { data } = await supabase
      .from('time_clock_integrations')
      .select('api_key, api_base_url, location_id')
      .eq('company_id', company_id)
      .maybeSingle()

    if (!data) {
      return NextResponse.json({ success: false, message: 'No time clock integration configured. Save your credentials first.' })
    }

    const missing: string[] = []
    if (!data.api_key) missing.push('API Key')
    if (!data.api_base_url) missing.push('API Base URL')
    if (!data.location_id) missing.push('Location ID')

    if (missing.length > 0) {
      return NextResponse.json({ success: false, message: `Missing required fields: ${missing.join(', ')}. Fill them in and save first.` })
    }

    return NextResponse.json({ success: true, message: 'Credentials are saved. Live connection is tested when Aegis runs a payroll check.' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
