import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const { data } = await supabase
      .from('payroll_integrations')
      .select('api_key, company_identifier')
      .eq('company_id', company_id)
      .maybeSingle()

    if (!data) {
      return NextResponse.json({ success: false, message: 'No payroll integration configured. Save your credentials first.' })
    }

    const missing: string[] = []
    if (!data.api_key) missing.push('API Key')
    if (!data.company_identifier) missing.push('Company Identifier')

    if (missing.length > 0) {
      return NextResponse.json({ success: false, message: `Missing required fields: ${missing.join(', ')}. Fill them in and save first.` })
    }

    return NextResponse.json({ success: true, message: 'Credentials are saved. Live connection is tested when Aegis runs a payroll check.' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
