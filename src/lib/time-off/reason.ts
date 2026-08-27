// Decision (Alexander, 2026-08-26): when an employee gave no reason, the
// database holds NULL and every manager-facing surface shows "no reason given"
// — never a dash, never an invented "personal reasons". One place for the words
// (Rule 0b). Aegis renders the same string in its texts and emails.
export const NO_REASON_GIVEN = 'no reason given'

export function displayReason(reason: string | null | undefined): string {
  const t = (reason ?? '').trim()
  return t || NO_REASON_GIVEN
}
