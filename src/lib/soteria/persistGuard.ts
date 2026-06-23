// Pillar 3 (persistence): a tiny guard that makes a *swallowed* database write
// impossible.
//
// Soteria must never tell a manager a change was "saved" when the underlying
// write actually failed — that is the same bug class as the template-editor
// swallowed-save. Most executor cases already do `if (error) throw error`,
// which the route's outer catch turns into a non-success (500) response that
// the chat UI surfaces as "✗ …". A handful of writes (deletes, the profile
// upsert, the pre-clear steps of availability changes) historically dropped
// their { error } on the floor and returned `{ success: true }` regardless.
//
// Routing every data-modifying call's error through this guard guarantees a
// failed write throws loudly — with a plain-English context tag in the server
// log — instead of being reported to the manager as a successful save.

/** The error shape Supabase returns on the `{ data, error }` result object. */
export type WriteError =
  | { message?: string; code?: string; details?: string | null; hint?: string | null }
  | null
  | undefined

/** Error thrown when a write Soteria reported on actually failed. */
export class PersistError extends Error {
  code?: string
  constructor(context: string, error: WriteError) {
    const detail = error && error.message ? `: ${error.message}` : ''
    super(`Could not ${context}${detail}`)
    this.name = 'PersistError'
    this.code = error?.code
  }
}

/**
 * Throw if a Supabase write returned an error.
 *
 * @param error   the `error` field from a Supabase `{ data, error }` result
 * @param context plain-English description of the write, e.g. "delete employee Maria"
 *                — used in the thrown message and the server log.
 */
export function throwOnWriteError(error: WriteError, context: string): void {
  if (error) {
    throw new PersistError(context, error)
  }
}
