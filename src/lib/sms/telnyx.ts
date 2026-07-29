// Minimal Telnyx Messaging API client (outbound send) for Homebase.
//
// Mirrors the Aegis sender: a single authenticated POST to the Telnyx v2 API
// with { from, to, text }. The `from` number is the TENANT's own Telnyx number,
// resolved per-company by the caller from company_channels (channel_type='sms',
// channel_value) — never a hardcoded or global number. The messaging profile is
// bound to the number server-side, so it is not sent in the request body.

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages'
const SEND_TIMEOUT_MS = 10_000

export interface TelnyxSendParams {
  from: string // E.164, the tenant's own Telnyx number
  to: string // E.164 recipient
  text: string
}

export interface TelnyxSendResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendTelnyxSms(params: TelnyxSendParams): Promise<TelnyxSendResult> {
  const apiKey = process.env.TELNYX_API_KEY
  if (!apiKey) return { ok: false, error: 'TELNYX_API_KEY not configured' }
  if (!params.from) return { ok: false, error: 'missing from number (per-tenant SMS number unresolved)' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(TELNYX_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: params.from, to: params.to, text: params.text }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { errors?: Array<{ detail?: string; title?: string; code?: string }> }
        if (body.errors?.length) {
          const e = body.errors[0]
          detail = `Telnyx ${res.status}: ${e.detail || e.title || e.code || 'unknown error'}`
        }
      } catch {
        /* keep the HTTP-status fallback */
      }
      return { ok: false, error: detail }
    }

    const json = (await res.json()) as { data?: { id?: string } }
    return { ok: true, id: json.data?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}
