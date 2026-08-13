import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken, consumeToken, type ActionType, type TokenRow } from '@/lib/aegis-actions/tokens'
import { dispatchAction, dispatchSwapProposal } from '@/lib/aegis-actions/dispatcher'
import { actionResultTitle } from '@/lib/aegis-actions/labels'
import { AEGIS_LOGO_DATA_URI } from '@/lib/aegis-actions/aegisLogo'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Styled HTML helpers (Quria dark brand) ──────────────────────────────────

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// Accent color per tone. Success = green, error/denied = red, info = orange.
type Tone = 'success' | 'error' | 'info'
const TONE_ACCENT: Record<Tone, string> = {
  success: '#4ade80',
  error: '#f87171',
  info: '#f97316',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

/**
 * Renders a single, consistent Quria-branded result page. `bodyExtra` lets the
 * confirmation page inject its form below the message; everything else (error,
 * success) just shows title + message.
 */
function renderActionResultPage(opts: {
  title: string
  message: string
  tone: Tone
  bodyExtra?: string
  footnote?: string
}): string {
  const accent = TONE_ACCENT[opts.tone]
  const footnote = opts.footnote ?? 'You can close this tab.'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — Aegis</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #0d0d0d;
    color: #e8e8e8;
    font-family: ${FONT_STACK};
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 14px;
    max-width: 440px;
    width: 100%;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    background: #000000;
    border-bottom: 2px solid #f97316;
  }
  .header .logo {
    width: 56px;
    height: 56px;
    border-radius: 10px;
    display: block;
    flex-shrink: 0;
  }
  .header .wordmark {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #e8e8e8;
  }
  .body {
    padding: 32px 28px 28px;
    text-align: center;
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin: 0 auto 16px;
    background: ${accent};
    box-shadow: 0 0 0 5px ${accent}22;
  }
  .body h1 {
    font-size: 21px;
    font-weight: 700;
    margin: 0 0 10px;
    color: ${accent};
    letter-spacing: -0.01em;
  }
  .body p {
    color: #b0b0b0;
    line-height: 1.55;
    margin: 0;
    font-size: 15px;
  }
  .actions {
    margin-top: 24px;
  }
  .btn-primary {
    background: #f97316;
    color: #0d0d0d;
    border: none;
    padding: 13px 30px;
    border-radius: 9px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary:hover { background: #ea6a0c; }
  .footnote {
    margin-top: 22px;
    font-size: 13px;
    color: #777777;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <!-- B5: the real Aegis logo, inlined as a data URI (see aegisLogo.ts) so it
           renders on every result state without a second network request that a
           mail-client webview could block. -->
      <img class="logo" src="${AEGIS_LOGO_DATA_URI}" alt="Aegis" width="56" height="56">
      <span class="wordmark">Aegis</span>
    </div>
    <div class="body">
      <div class="status-dot"></div>
      <h1>${escapeHtml(opts.title)}</h1>
      <p>${escapeHtml(opts.message)}</p>
      ${opts.bodyExtra ?? ''}
      <div class="footnote">${escapeHtml(footnote)}</div>
    </div>
  </div>
</div>
</body>
</html>`
}

// ── Action description templates ─────────────────────────────────────────────

function describeAction(action_type: ActionType, payload: Record<string, unknown>): string {
  const get = (k: string): string | null => {
    const v = payload[k]
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const employee = get('employee_name')
  const dateRange = get('date_range')
  const shiftName = get('shift_name')
  const date = get('date')
  const week = get('week')

  switch (action_type) {
    case 'approve_to':
      return employee && dateRange
        ? `Approve ${employee}'s time-off request for ${dateRange}?`
        : 'Approve this time-off request?'
    case 'deny_to':
      return employee && dateRange
        ? `Deny ${employee}'s time-off request for ${dateRange}?`
        : 'Deny this time-off request?'
    case 'recheck_to':
      return employee && dateRange
        ? `Re-run Aegis's coverage check on ${employee}'s time-off request for ${dateRange}.`
        : "Re-run Aegis's coverage check on this time-off request."
    case 'approve_availability':
      return employee
        ? `Approve ${employee}'s availability change?`
        : 'Approve this availability change?'
    case 'deny_availability':
      return employee
        ? `Deny ${employee}'s availability change?`
        : 'Deny this availability change?'
    case 'accept_emergency_coverage':
      return shiftName && date
        ? `Accept the ${shiftName} shift on ${date}?`
        : 'Accept this emergency coverage shift?'
    case 'decline_emergency_coverage':
      return shiftName && date
        ? `Decline the ${shiftName} shift on ${date}?`
        : 'Decline this emergency coverage shift?'
    case 'confirm_distribution':
      return week
        ? `Send the ${week} schedule to all employees?`
        : 'Send the schedule to all employees?'
    case 'request_additional_batch':
      return 'Search for more coverage candidates?'
    case 'swap_pickup': {
      const requester = get('requester_name')
      return shiftName && date
        ? `Pick up${requester ? ` ${requester}'s` : ''} ${shiftName} shift on ${date} and add it to your schedule?`
        : 'Pick up this shift and add it to your schedule?'
    }
    case 'swap_agree': {
      const receiver = get('receiver_name')
      const targetShift = get('target_shift_name')
      return receiver && shiftName && targetShift
        ? `Agree to trade your ${shiftName} for ${receiver}'s ${targetShift}? (Then it goes to your manager.)`
        : 'Agree to this trade? (Then it goes to your manager.)'
    }
    case 'swap_decline':
      return 'Decline this trade and keep your shift?'
    default:
      return 'Confirm this action?'
  }
}

function actionTitle(action_type: ActionType): string {
  // B5 — plain-English titles that distinguish a one-way pickup from a trade
  // (shared with SwapsTab via lib/aegis-actions/labels).
  return actionResultTitle(action_type)
}

// ── Error page ──────────────────────────────────────────────────────────────

function errorPage(kind: 'invalid' | 'expired' | 'consumed' | 'failed', detail?: string): string {
  const titles: Record<string, string> = {
    invalid: 'This link isn\'t valid',
    expired: 'This link has expired',
    consumed: 'This link was already used',
    failed: 'Something went wrong',
  }
  const messages: Record<string, string> = {
    invalid: 'I couldn\'t read this link. Check the email for the right one, or ask your manager to resend it.',
    expired: 'This link has expired. Ask your manager to resend it and I\'ll take it from there.',
    consumed: 'This link has already been used — your last action went through, so nothing was missed. Check your inbox or Homebase to confirm where it stands.',
    failed: detail ?? 'I hit an unexpected error. Try again, or contact your manager if it keeps happening.',
  }

  return renderActionResultPage({
    title: titles[kind],
    message: messages[kind],
    tone: 'error',
  })
}

// ── Confirmation page (GET success) ─────────────────────────────────────────

function confirmPage(token: string, row: TokenRow): string {
  const description = describeAction(row.action_type, row.payload)
  const bodyExtra = `
      <form method="POST" action="/api/aegis-action?token=${encodeURIComponent(token)}" class="actions">
        <button type="submit" class="btn-primary">Confirm</button>
      </form>`
  return renderActionResultPage({
    title: actionTitle(row.action_type),
    message: description,
    tone: 'info',
    bodyExtra,
    footnote: 'You can close this tab if you change your mind.',
  })
}

// ── Swap shift-picker page (#10, GET for swap_trade_select) ──────────────────
// The candidate chooses which of their OWN shifts to trade for the requester's.
// Options come from the token payload (self-contained); the form POSTs the chosen
// index back, which the route resolves server-side against the same payload.

function swapPickerPage(token: string, row: TokenRow): string {
  const p = row.payload
  const requester = (typeof p.requester_name === 'string' && p.requester_name) || 'your coworker'
  const reqShift = (typeof p.shift_name === 'string' && p.shift_name) || 'their shift'
  const reqDate = typeof p.date === 'string' ? p.date : ''
  const shifts = Array.isArray(p.tradeable_shifts) ? (p.tradeable_shifts as Array<Record<string, unknown>>) : []

  if (shifts.length === 0) {
    return renderActionResultPage({
      title: 'Nothing to trade here',
      message: `You don't have a shift that fits a trade for ${escapeHtml(requester)}'s ${escapeHtml(reqShift)}. If you'd still like to help, use the "I'll pick it up" button in the email instead.`,
      tone: 'info',
    })
  }

  const options = shifts
    .map((s, i) => {
      const name = escapeHtml(String(s.shift_name ?? 'Shift'))
      const date = escapeHtml(String(s.date ?? ''))
      const role = escapeHtml(String(s.role ?? ''))
      const start = escapeHtml(String(s.start_time ?? ''))
      const end = escapeHtml(String(s.end_time ?? ''))
      const meta = [date, role].filter(Boolean).join(', ')
      const time = start && end ? ` (${start}–${end})` : ''
      return `
        <label style="display:block;text-align:left;border:1px solid #2a2a2a;border-radius:10px;padding:14px 16px;margin:0 0 10px;cursor:pointer;background:#0d0d0d;">
          <input type="radio" name="shift_index" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-right:10px;vertical-align:middle;">
          <strong style="color:#e8e8e8;">${name}</strong><span style="color:#9a9a9a;">${meta ? ` — ${meta}` : ''}${time}</span>
        </label>`
    })
    .join('')

  const bodyExtra = `
      <form method="POST" action="/api/aegis-action?token=${encodeURIComponent(token)}" class="actions" style="display:block;">
        <div style="margin:0 0 18px;">${options}</div>
        <button type="submit" class="btn-primary">Propose this trade</button>
      </form>`

  const intro = `You'd take ${escapeHtml(requester)}'s ${escapeHtml(reqShift)}${reqDate ? ` on ${escapeHtml(reqDate)}` : ''}. In return, choose one of your own shifts to give up:`

  return renderActionResultPage({
    title: 'Swap a shift',
    message: intro,
    tone: 'info',
    bodyExtra,
    footnote: 'Your coworker and your manager both confirm before anything changes.',
  })
}

// ── Success page (POST success) ─────────────────────────────────────────────

function successPage(message: string): string {
  return renderActionResultPage({
    title: 'All set',
    message,
    tone: 'success',
  })
}

// ── Route handlers ──────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return htmlResponse(errorPage('invalid'), 400)

  const result = await verifyToken(token, supabase)
  if (!result.ok) {
    const status = result.error === 'invalid' ? 404 : 410
    return htmlResponse(errorPage(result.error), status)
  }

  // The swap picker is interactive (choose which of your shifts to trade), so it
  // gets its own page instead of the single-Confirm page.
  if (result.row.action_type === 'swap_trade_select') {
    return htmlResponse(swapPickerPage(token, result.row))
  }

  return htmlResponse(confirmPage(token, result.row))
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return htmlResponse(errorPage('invalid'), 400)

  const consumed = await consumeToken(token, supabase)
  if (!consumed.ok) {
    const status = consumed.error === 'invalid' ? 404 : 410
    return htmlResponse(errorPage(consumed.error), status)
  }

  const { row } = consumed

  // Swap picker: the chosen shift comes from the form. Resolve the selected index
  // server-side against the SAME token payload (don't trust client-sent details).
  if (row.action_type === 'swap_trade_select') {
    const form = await request.formData()
    const idxRaw = form.get('shift_index')
    const idx = typeof idxRaw === 'string' ? parseInt(idxRaw, 10) : NaN
    const shifts = Array.isArray(row.payload.tradeable_shifts)
      ? (row.payload.tradeable_shifts as Array<Record<string, unknown>>)
      : []
    const sel = Number.isInteger(idx) && idx >= 0 && idx < shifts.length ? shifts[idx] : null
    if (!sel) {
      return htmlResponse(errorPage('failed', 'No shift was selected — go back and pick one of your shifts to trade.'), 400)
    }
    const proposal = await dispatchSwapProposal(row, sel, supabase)
    if (!proposal.ok) {
      return htmlResponse(errorPage('failed', proposal.message), 500)
    }
    return htmlResponse(successPage(proposal.message))
  }

  const dispatch = await dispatchAction(row, supabase)

  if (!dispatch.ok) {
    return htmlResponse(errorPage('failed', dispatch.message), 500)
  }

  // Each wired handler writes its own human-readable activity_log row with
  // metadata.source='magic_link' (see dispatcher.ts + time-off/decide.ts).
  // The token_consumed lifecycle is already captured on the aegis_action_tokens
  // row itself (consumed_at), so a second feed entry here was purely duplicative.

  return htmlResponse(successPage(dispatch.message))
}
