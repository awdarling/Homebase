import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyToken, consumeToken, type ActionType, type TokenRow } from '@/lib/aegis-actions/tokens'
import { dispatchAction } from '@/lib/aegis-actions/dispatcher'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Styled HTML helpers ─────────────────────────────────────────────────────

const BASE_STYLE = `
  :root {
    --bg-base: #0d0d0d;
    --bg-surface-1: #111111;
    --bg-surface-2: #141414;
    --border-default: #2a2a2a;
    --text-primary: #e8e8e8;
    --text-secondary: #999999;
    --text-muted: #555555;
    --accent: #f97316;
    --accent-dark: #c2582a;
    --status-ready-text: #4ade80;
    --status-blocked-text: #f87171;
    --radius-md: 8px;
    --radius-lg: 12px;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg-base);
    color: var(--text-primary);
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100vh;
  }
  .wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: var(--bg-surface-1);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: 40px 32px;
    max-width: 480px;
    width: 100%;
    text-align: center;
  }
  .card h1 {
    font-family: 'Syne', sans-serif;
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: var(--text-primary);
  }
  .card p {
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0 0 24px 0;
    font-size: 15px;
  }
  .icon {
    font-size: 36px;
    margin-bottom: 12px;
    display: block;
  }
  .btn-primary {
    background: var(--accent);
    color: #0d0d0d;
    border: none;
    padding: 12px 28px;
    border-radius: var(--radius-md);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary:hover { background: var(--accent-dark); }
  .cancel-note {
    margin-top: 18px;
    font-size: 13px;
    color: var(--text-muted);
  }
  .ok-icon { color: var(--status-ready-text); }
  .err-icon { color: var(--status-blocked-text); }
`

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Homebase</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="card">${body}</div>
</div>
</body>
</html>`
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
    default:
      return 'Confirm this action?'
  }
}

function actionTitle(action_type: ActionType): string {
  return action_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Error page ──────────────────────────────────────────────────────────────

function errorPage(kind: 'invalid' | 'expired' | 'consumed' | 'failed', detail?: string): string {
  const titles: Record<string, string> = {
    invalid: 'Invalid link',
    expired: 'Link expired',
    consumed: 'Already used',
    failed: 'Something went wrong',
  }
  const messages: Record<string, string> = {
    invalid: 'This link is not valid. Check the message for the correct link, or ask your manager to resend it.',
    expired: 'This link has expired. Ask your manager to resend it.',
    consumed: 'This link has already been used. If this wasn\'t you, contact your manager.',
    failed: detail ?? 'We hit an unexpected error. Try again, or contact your manager if the problem persists.',
  }

  const body = `
    <span class="icon err-icon">⚠</span>
    <h1>${escapeHtml(titles[kind])}</h1>
    <p>${escapeHtml(messages[kind])}</p>
    <div class="cancel-note">You can close this tab.</div>
  `
  return htmlShell(titles[kind], body)
}

// ── Confirmation page (GET success) ─────────────────────────────────────────

function confirmPage(token: string, row: TokenRow): string {
  const description = describeAction(row.action_type, row.payload)
  const body = `
    <h1>${escapeHtml(actionTitle(row.action_type))}</h1>
    <p>${escapeHtml(description)}</p>
    <form method="POST" action="/api/aegis-action?token=${encodeURIComponent(token)}">
      <button type="submit" class="btn-primary">Confirm</button>
    </form>
    <div class="cancel-note">You can close this tab if you change your mind.</div>
  `
  return htmlShell('Confirm action', body)
}

// ── Success page (POST success) ─────────────────────────────────────────────

function successPage(message: string): string {
  const body = `
    <span class="icon ok-icon">✓</span>
    <h1>Done</h1>
    <p>${escapeHtml(message)}</p>
    <div class="cancel-note">You can close this tab.</div>
  `
  return htmlShell('Done', body)
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
