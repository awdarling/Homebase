// Print an HTML document from the app without opening a popup window.
//
// ── HISTORY ───────────────────────────────────────────────────────────────────
//
// Finding I2 (2026-08-11): the Download → "PDF / Print" button called
// `window.open()` AFTER `await fetch(...)`. Opening a window after an async gap
// is no longer treated as a user gesture, so the popup blocker killed it and the
// handler threw "Popup blocked" — what the manager saw as a crash. PR #65
// replaced it with a hidden same-document iframe: nothing to block, and the
// browser's own print dialog includes "Save as PDF".
//
// L2 (2026-08-16): managers reported that the print screen now OPENS and THEN
// crashes. Diagnosis (see DELIVERY_L2): the iframe approach was right, its
// CLEANUP was not.
//
// ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────────
//
// Measured in real Chromium (Playwright, chromium-1194):
//
//     19ms  iframe.onload
//    119ms  about to call win.print()
//    121ms  beforeprint
//    121ms  win.print() returned after 2ms   ← NON-BLOCKING
//    622ms  +500ms after print(): afterprint fired 0 times
//
// Two facts fall out of that trace, and together they are the bug:
//
//   1. `win.print()` RETURNS IMMEDIATELY. The calling code therefore has no idea
//      whether the print dialog is still open. It cannot use its own return as a
//      signal for anything.
//   2. `afterprint` is NOT guaranteed to fire. In headed browsers it fires when
//      the dialog is dismissed — which may be seconds or minutes later, or never
//      if the tab is backgrounded.
//
// The previous implementation registered an UNCONDITIONAL
// `setTimeout(cleanup, 60000)` immediately after `print()` returned, and cleanup
// removed the iframe. So: if the manager was still in the print preview 60
// seconds later — choosing a printer, scrolling a seven-column landscape
// schedule, or simply interrupted — the iframe was torn out from under the
// browser while it was rendering that document. The preview dies. That is the
// "opens the print screen, then crashes" report, and it explains why it was
// intermittent: it was a stopwatch race against the user.
//
// The `afterprint` → 500ms → remove path had the same defect in miniature. On
// macOS Chrome, "Save as PDF" fires afterprint when the dialog closes and THEN
// serialises the document; removing it 500ms later races that write and can
// produce an empty or failed PDF.
//
// ── THE RULE THIS MODULE NOW FOLLOWS ──────────────────────────────────────────
//
// NEVER remove the iframe on a timer that could plausibly fire while a human is
// still in the print dialog. Only remove it on positive evidence that printing
// is over:
//
//   • `afterprint` on the iframe window (+ a generous settle delay for the
//     browser's PDF write), or
//   • the parent window regaining focus, which is how a dismissed print dialog
//     always ends, or
//   • the next print starting (a stale frame is swept before a new one is made —
//     idempotent and impossible to mistime), or
//   • a deliberately absurd backstop (see PRINT_BACKSTOP_MS) that exists only to
//     stop a long-lived tab leaking DOM nodes, and is far outside any plausible
//     print interaction.
//
// Leaving a 1×1 hidden iframe attached for a few extra minutes costs nothing.
// Removing it one second too early breaks the manager's download. The asymmetry
// is the whole design.

/** Settle delay after `afterprint` before detaching. The browser may still be
 *  serialising the document (macOS Chrome "Save as PDF" fires afterprint when
 *  the dialog closes, then writes the file). The old value was 500ms, which
 *  raced that write on a slow machine. */
export const AFTERPRINT_SETTLE_MS = 5_000

/** Settle delay after the parent window regains focus. Shorter than the
 *  afterprint path because focus returning is a later, stronger signal — the
 *  dialog is already gone. */
export const REFOCUS_SETTLE_MS = 2_000

/** Last-resort backstop so a tab left open for hours doesn't accumulate frames.
 *  Ten minutes, deliberately: no one is in a print dialog for ten minutes, so
 *  this can never be the thing that kills a live preview. The old code used
 *  60 SECONDS here, which absolutely could — and did. */
export const PRINT_BACKSTOP_MS = 10 * 60 * 1000

/** Delay between attaching the iframe and calling print(), to let it lay out. */
export const LAYOUT_SETTLE_MS = 100

/** Marks frames this module owns, so stale ones can be swept without touching
 *  any other iframe on the page. */
export const PRINT_FRAME_ATTR = 'data-quria-print-frame'

/** The seams this module needs from the environment. Injected so the lifecycle
 *  is testable without a browser — this logic broke precisely because it was
 *  untestable and therefore untested. */
export interface PrintEnv {
  document: Document
  window: Window
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

function defaultEnv(): PrintEnv | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  return {
    document,
    window,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: h => window.clearTimeout(h as number),
  }
}

/** Detach any print frame left over from a previous run. Safe to call any time:
 *  if a previous print is genuinely still open, the user is looking at a dialog
 *  for THAT document and is not simultaneously clicking Download again. */
export function sweepStalePrintFrames(env: PrintEnv): number {
  const stale = env.document.querySelectorAll(`iframe[${PRINT_FRAME_ATTR}]`)
  stale.forEach(node => node.remove())
  return stale.length
}

export interface PrintResult {
  /** Frames swept before this run started. */
  swept: number
  /** Called by tests/callers to force teardown; no-op once cleanup has run. */
  dispose: () => void
}

/**
 * Renders `html` into a hidden iframe and opens the browser's print dialog.
 *
 * Returns synchronously — printing is asynchronous and the dialog outlives this
 * call. Cleanup is handled internally per the rule documented above; callers
 * must NOT remove the frame themselves.
 */
export function printHtmlViaHiddenIframe(html: string, injectedEnv?: PrintEnv): PrintResult | null {
  const env = injectedEnv ?? defaultEnv()
  if (!env) return null

  // Sweep first: a stale frame from an earlier download is the only thing we can
  // safely remove, because by definition its dialog is no longer the one in
  // front of the user.
  const swept = sweepStalePrintFrames(env)

  const iframe = env.document.createElement('iframe')
  iframe.setAttribute(PRINT_FRAME_ATTR, '1')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('tabindex', '-1')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  // 1×1 rather than 0×0. A zero-area frame has no layout box, and some print
  // paths lay the document out against the frame's box rather than the paper —
  // producing a blank preview. One pixel costs nothing and removes the question.
  iframe.style.width = '1px'
  iframe.style.height = '1px'
  iframe.style.opacity = '0'
  iframe.style.border = '0'
  iframe.style.pointerEvents = 'none'
  iframe.srcdoc = html

  let cleanedUp = false
  let backstop: unknown = null
  let printed = false

  const detach = () => {
    if (cleanedUp) return
    cleanedUp = true
    if (backstop !== null) env.clearTimeout(backstop)
    env.window.removeEventListener('focus', onParentFocus)
    iframe.remove()
  }

  // Schedules the actual detach after a settle delay. Never called from a timer
  // that could plausibly overlap an open dialog — only from a signal that
  // printing has finished.
  const finish = (settleMs: number) => {
    if (cleanedUp) return
    env.setTimeout(detach, settleMs)
  }

  function onParentFocus() {
    // Focus comes back to the app when the print dialog closes — including the
    // Cancel path, and including browsers that never fire afterprint at all
    // (measured: Chromium fired beforeprint but not afterprint). Ignore focus
    // events that arrive before we've actually asked to print.
    if (!printed) return
    finish(REFOCUS_SETTLE_MS)
  }

  iframe.onload = () => {
    // Guard against a second load event (an in-document navigation would
    // otherwise fire print() again while the first dialog is still open, which
    // browsers handle badly).
    if (printed) return

    const win = iframe.contentWindow
    if (!win) { detach(); return }

    win.addEventListener('afterprint', () => finish(AFTERPRINT_SETTLE_MS))

    env.setTimeout(() => {
      if (cleanedUp) return
      printed = true
      env.window.addEventListener('focus', onParentFocus)
      try {
        win.focus()
        win.print()
      } catch {
        // print() itself failed (blocked, or the frame went away). Nothing is on
        // screen, so tearing down immediately is safe here — this is the ONE
        // path where we know for certain no dialog is open.
        detach()
        return
      }
      // Backstop ONLY. Ten minutes out, purely to bound DOM growth. It must
      // never be the mechanism that ends a normal print.
      backstop = env.setTimeout(detach, PRINT_BACKSTOP_MS)
    }, LAYOUT_SETTLE_MS)
  }

  env.document.body.appendChild(iframe)

  return { swept, dispose: detach }
}
