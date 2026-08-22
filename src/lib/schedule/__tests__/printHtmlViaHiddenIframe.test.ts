// L2 regression suite — the hidden-iframe print lifecycle.
//
// THE BUG: managers reported the Download → "PDF / Print" button opening the
// print screen and then crashing. The server side was fine (the route returned
// HTML, which is why the print screen appeared at all). The defect was cleanup:
// the shipped code registered an unconditional `setTimeout(cleanup, 60000)`
// right after calling print(), and cleanup removed the iframe. A manager still
// in the print dialog at T+60s had the document torn out from under the browser.
//
// Measured in real Chromium (Playwright chromium-1194) before the fix:
//     121ms  win.print() returned after 2ms   ← NON-BLOCKING
//     622ms  afterprint fired 0 times
// So the code could not know whether a dialog was open, and could not rely on
// afterprint to tell it.
//
// These tests drive the lifecycle through a fake DOM + fake clock, which is the
// point: the logic was inlined in a React page component and therefore untested.
//
// Run: npx tsx src/lib/schedule/__tests__/printHtmlViaHiddenIframe.test.ts

import {
  printHtmlViaHiddenIframe,
  sweepStalePrintFrames,
  PRINT_FRAME_ATTR,
  PRINT_BACKSTOP_MS,
  AFTERPRINT_SETTLE_MS,
  REFOCUS_SETTLE_MS,
  LAYOUT_SETTLE_MS,
  type PrintEnv,
} from '../printHtmlViaHiddenIframe'

let failures = 0
function expect(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`✗ ${msg}`); failures++ }
}

// ── Minimal fake DOM + controllable clock ────────────────────────────────────

interface FakeWin {
  focus: () => void
  print: () => void
  addEventListener: (t: string, fn: () => void) => void
  _fire: (t: string) => void
}

interface FakeFrame {
  attrs: Record<string, string>
  style: Record<string, string>
  srcdoc: string
  onload: (() => void) | null
  contentWindow: FakeWin | null
  attached: boolean
  setAttribute: (k: string, v: string) => void
  remove: () => void
}

class Harness {
  now = 0
  timers: Array<{ at: number; fn: () => void; id: number; cancelled: boolean }> = []
  nextId = 1
  frames: FakeFrame[] = []
  parentListeners: Record<string, Array<() => void>> = {}
  printCalls = 0
  printThrows = false
  /** The critical instrument: was the frame detached while a dialog was open? */
  dialogOpen = false
  detachedDuringDialog = false

  makeWin(frame: FakeFrame): FakeWin {
    const listeners: Record<string, Array<() => void>> = {}
    return {
      focus: () => {},
      print: () => {
        this.printCalls++
        if (this.printThrows) throw new Error('print blocked')
        this.dialogOpen = true
      },
      addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn) },
      _fire: t => (listeners[t] ?? []).forEach(fn => fn()),
    }
  }

  env: PrintEnv

  constructor() {
    const self = this
    const doc = {
      createElement: (): FakeFrame => {
        const frame: FakeFrame = {
          attrs: {}, style: {}, srcdoc: '', onload: null, contentWindow: null,
          attached: false,
          setAttribute: (k, v) => { frame.attrs[k] = v },
          remove: () => {
            if (frame.attached && self.dialogOpen) self.detachedDuringDialog = true
            frame.attached = false
            self.frames = self.frames.filter(f => f !== frame)
          },
        }
        frame.contentWindow = self.makeWin(frame)
        return frame
      },
      querySelectorAll: (sel: string) => {
        const want = `iframe[${PRINT_FRAME_ATTR}]`
        const hits = sel === want ? self.frames.filter(f => f.attrs[PRINT_FRAME_ATTR]) : []
        return { forEach: (fn: (f: FakeFrame) => void) => [...hits].forEach(fn), length: hits.length }
      },
      body: { appendChild: (f: FakeFrame) => { f.attached = true; self.frames.push(f) } },
    }
    const win = {
      addEventListener: (t: string, fn: () => void) => { (self.parentListeners[t] ??= []).push(fn) },
      removeEventListener: (t: string, fn: () => void) => {
        self.parentListeners[t] = (self.parentListeners[t] ?? []).filter(f => f !== fn)
      },
    }
    this.env = {
      document: doc as unknown as Document,
      window: win as unknown as Window,
      setTimeout: (fn, ms) => {
        const id = self.nextId++
        self.timers.push({ at: self.now + ms, fn, id, cancelled: false })
        return id
      },
      clearTimeout: h => {
        const t = self.timers.find(x => x.id === h)
        if (t) t.cancelled = true
      },
    }
  }

  /** Advance the fake clock, running due timers in order. */
  advance(ms: number): void {
    const target = this.now + ms
    for (;;) {
      const due = this.timers
        .filter(t => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.cancelled = true
      this.now = due.at
      due.fn()
    }
    this.now = target
  }

  /** Simulate the user dismissing the print dialog: focus returns to the app. */
  dismissDialog(opts: { fireAfterprint: boolean }): void {
    this.dialogOpen = false
    if (opts.fireAfterprint) this.frames.forEach(f => f.contentWindow?._fire('afterprint'))
    ;(this.parentListeners['focus'] ?? []).slice().forEach(fn => fn())
  }

  get liveFrames(): number { return this.frames.filter(f => f.attached).length }
}

const HTML = '<!DOCTYPE html><html><body>schedule</body></html>'

// ── THE REGRESSION: a slow user must not have the frame yanked ───────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()          // frame loads
  h.advance(LAYOUT_SETTLE_MS)                   // → print() called

  expect(h.printCalls === 1, 'print() is called once after the layout settle delay')
  expect(h.dialogOpen, 'the print dialog is open')

  // The old code removed the iframe here. This is the exact reported crash.
  h.advance(61_000)
  expect(!h.detachedDuringDialog, 'THE BUG: the frame is NOT removed while the dialog is still open at 61s')
  expect(h.liveFrames === 1, 'the frame survives past the old 60-second timer')

  // Even a genuinely slow user is safe well past any real print interaction.
  h.advance(5 * 60_000)
  expect(!h.detachedDuringDialog, 'still not removed after 6 minutes in the dialog')
}

// ── Normal completion: afterprint fires ──────────────────────────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)

  h.dismissDialog({ fireAfterprint: true })
  expect(h.liveFrames === 1, 'the frame is still attached immediately after afterprint (PDF write may be in flight)')

  h.advance(AFTERPRINT_SETTLE_MS + 100)
  expect(h.liveFrames === 0, 'the frame is detached after the afterprint settle delay')
  expect(!h.detachedDuringDialog, 'detach happened after the dialog closed, never during')
}

// ── Chromium's measured behaviour: afterprint NEVER fires ────────────────────
{
  // This is the case the probe actually recorded. Cleanup must still happen —
  // via the parent regaining focus — without ever depending on afterprint.
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)

  h.dismissDialog({ fireAfterprint: false })
  h.advance(REFOCUS_SETTLE_MS + 100)
  expect(h.liveFrames === 0, 'a browser that never fires afterprint still cleans up, via parent focus')
  expect(!h.detachedDuringDialog, 'focus-driven cleanup also never fires during the dialog')
}

// ── Focus events BEFORE print must not trigger cleanup ───────────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  // A stray focus event during the layout settle window, before print() ran.
  ;(h.parentListeners['focus'] ?? []).forEach(fn => fn())
  h.advance(LAYOUT_SETTLE_MS)
  expect(h.printCalls === 1, 'a focus event before print() does not cancel the print')
  expect(h.liveFrames === 1, 'a focus event before print() does not detach the frame')
}

// ── The backstop bounds DOM growth without endangering a dialog ──────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)
  h.dialogOpen = false            // user walked away; dialog closed by the OS, no events

  h.advance(PRINT_BACKSTOP_MS + 1000)
  expect(h.liveFrames === 0, 'the backstop eventually detaches an abandoned frame (no DOM leak)')
  expect(PRINT_BACKSTOP_MS >= 10 * 60_000, 'the backstop is far longer than any real print interaction')
}

// ── onload firing twice must not double-print ────────────────────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0)
  h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)
  h.frames[0].onload!()           // an in-document navigation refires load
  h.advance(LAYOUT_SETTLE_MS)
  expect(h.printCalls === 1, 'a second load event does not call print() again over an open dialog')
}

// ── A failed print() is the ONE safe immediate teardown ──────────────────────
{
  const h = new Harness()
  h.printThrows = true
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)
  expect(h.liveFrames === 0, 'when print() throws, nothing is on screen, so the frame is torn down at once')
  expect(!h.detachedDuringDialog, 'a failed print never counts as detaching during a dialog')
}

// ── A frame with no contentWindow tears down instead of hanging ──────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0)
  h.frames[0].contentWindow = null
  h.frames[0].onload!()
  expect(h.liveFrames === 0, 'a frame with no contentWindow is removed rather than left dangling')
  expect(h.printCalls === 0, 'print() is not attempted without a contentWindow')
}

// ── A stale frame is swept by the NEXT print, not by a timer ─────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  h.advance(0); h.frames[0].onload!()
  h.advance(LAYOUT_SETTLE_MS)
  h.dialogOpen = false            // first dialog gone, but no events fired

  const second = printHtmlViaHiddenIframe(HTML, h.env)
  expect(second!.swept === 1, 'starting a new print sweeps the previous frame')
  expect(h.liveFrames === 1, 'exactly one print frame exists after a re-print')
}

// ── The frame is marked, hidden, and NOT zero-sized ──────────────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  const f = h.frames[0]
  expect(f.attrs[PRINT_FRAME_ATTR] === '1', 'the frame is tagged so it can be swept without touching other iframes')
  expect(f.attrs['aria-hidden'] === 'true', 'the frame is hidden from assistive tech')
  // 0x0 frames have no layout box, which some print paths lay the document out
  // against — producing a blank preview.
  expect(f.style.width === '1px' && f.style.height === '1px', 'the frame is 1x1, not 0x0')
  expect(f.srcdoc === HTML, 'the schedule HTML is rendered via srcdoc (no popup to block)')
}

// ── sweepStalePrintFrames only touches our own frames ────────────────────────
{
  const h = new Harness()
  printHtmlViaHiddenIframe(HTML, h.env)
  const foreign = h.env.document.createElement('iframe') as unknown as FakeFrame
  h.env.document.body.appendChild(foreign as unknown as Node)
  expect(h.liveFrames === 2, 'two frames attached (ours + a foreign one)')
  const swept = sweepStalePrintFrames(h.env)
  expect(swept === 1, 'only the tagged print frame is swept')
  expect(h.liveFrames === 1, 'the foreign iframe is left alone')
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll printHtmlViaHiddenIframe checks passed.')
