/**
 * Aegis internal-bridge client.
 *
 * Lets Homebase-side magic-link action dispatchers (src/lib/aegis-actions/dispatcher.ts)
 * trigger the matching server-side workflow in the Aegis repo. The two repos
 * stay independently deployable; this is the only point of programmatic coupling.
 *
 * Required env vars (mirror the names in the Aegis repo):
 *   AEGIS_URL              — base URL of the Aegis service (e.g. https://aegis.internal.quria.dev)
 *   AEGIS_INTERNAL_SECRET  — shared bearer token. Aegis rejects requests without it.
 *
 * Both MUST be set wherever the magic-link action endpoint runs (locally + Vercel).
 * The dispatcher catches errors from this helper so a downstream Aegis failure
 * doesn't roll back the local DB write — see notify-to-decision handling in
 * dispatcher.ts for the partial-success pattern.
 */

export type AegisInternalEndpoint =
  | '/internal/notify-to-decision'
  | '/internal/notify-swap-decision'
  | '/internal/distribute-schedule'
  | '/internal/build-schedule'
  | '/internal/notify-schedule-changes'
  | '/internal/apply-availability-decision'
  | '/internal/apply-custom-availability-decision'
  | '/internal/decide-availability-change'
  | '/internal/notify-day-closure'
  | '/internal/recompute-to-recommendation'
  | '/internal/recheck-to-reply'
  | '/internal/notify-access-removed'
  | '/internal/swap-pickup-commit'
  | '/internal/swap-propose'
  | '/internal/swap-proposal-decision'

export class AegisInternalError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message)
    this.name = 'AegisInternalError'
  }
}

export class AegisInternalConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AegisInternalConfigError'
  }
}

export async function postToAegisInternal<T = unknown>(
  endpoint: AegisInternalEndpoint,
  payload: Record<string, unknown>,
): Promise<T> {
  const baseUrl = process.env.AEGIS_URL
  const secret = process.env.AEGIS_INTERNAL_SECRET

  if (!baseUrl) {
    throw new AegisInternalConfigError(
      'AEGIS_URL is not set — magic-link dispatchers cannot reach the Aegis service. Set it in .env.local (and on Vercel) before using email-action workflows.',
    )
  }
  if (!secret) {
    throw new AegisInternalConfigError(
      'AEGIS_INTERNAL_SECRET is not set — magic-link dispatchers cannot authenticate to Aegis. Must match the AEGIS_INTERNAL_SECRET in the Aegis repo.',
    )
  }

  const url = baseUrl.replace(/\/+$/, '') + endpoint

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()

  if (!res.ok) {
    throw new AegisInternalError(
      `Aegis ${endpoint} returned ${res.status}: ${text.slice(0, 240)}`,
      res.status,
      text,
    )
  }

  if (text.length === 0) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new AegisInternalError(
      `Aegis ${endpoint} returned non-JSON body: ${text.slice(0, 240)}`,
      res.status,
      text,
    )
  }
}
