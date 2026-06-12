import type { ColorConfig } from '@/lib/types'
import type { CellKind } from './buildScheduleGrid'

// ── Shared cell-appearance resolver ──────────────────────────────────────────
//
// CONTRACT (Piece 1 of the template-unification effort).
//
// This is the single source of truth for "what color is a schedule cell" across
// the three surfaces that render the same schedule:
//   (1) the on-screen Homebase grid  (ScheduleRenderer.tsx)
//   (2) the Excel download           (renderScheduleGridXlsx.ts)
//   (3) the PDF/print HTML download  (renderScheduleGridHtml.ts)
//
// Before this module each surface forked its own color logic: the on-screen
// grid colored every cell from the TEMPLATE's per-day/per-shift color, while the
// two download renderers ignored that color entirely and painted by cell-kind
// from a fixed palette — collapsing seven distinct day colors into one uniform
// navy ("all-blue") that did not match the screen. Routing all three through
// this resolver fixes that.
//
// Resolution rule — mirrors the on-screen `getColor(col, row)` EXACTLY:
//   • color_config.by === 'day'    → the column's color
//   • color_config.by === 'shift'  → color_config.map[rowId] ?? column color
//   • anything else ('role'|'none')→ the column's color
// NOTE: color is template-driven (day/shift), NOT role-driven. There is no
// role-color path on any surface today. Pieces 2/3 (saveTemplate wiring, Aegis
// distribute email) consume this same resolver; widen the RETURN object if a
// surface needs more attrs, but keep this signature stable.

/** Tint strength applied to the resolved color for a non-empty cell body. */
export const CELL_TINT_ALPHA = 0.06

// On-screen background strings. These are the EXACT CSS values the live grid
// produces today; the resolver returns them verbatim so the UI render is
// byte-identical after the refactor. (`--bg-base` is a dark theme token — the
// on-screen surface is dark; the static download surfaces re-express the same
// appearance in light/print terms via the `fill` field below.)
const EMPTY_BG_CSS = 'var(--bg-base)'
const CLOSED_BG_CSS = 'rgba(107,114,128,0.08)'

// Light/print equivalents for the two theme-token backgrounds above. The
// download is always a white-background artifact, so an empty cell is plain
// white and a closed cell is the same neutral grey (#6B7280) blended onto white
// at the on-screen 0.08 alpha.
const EMPTY_FILL_HEX = '#FFFFFF'
const CLOSED_FILL_HEX = blendOnWhite('#6B7280', 0.08) // ≈ #F3F4F5

/** Inputs the resolver needs — surface-neutral; no DOM/Excel assumptions. */
export interface CellAppearanceInput {
  colorConfig: ColorConfig
  /** The day column's template color, e.g. '#FF8C00'. */
  columnColor: string
  /** The shift row id — used only when color_config.by === 'shift'. */
  rowId: string
  /** How the cell is classified (drives empty / closed vs. tinted body). */
  kind: CellKind
}

/** Normalized, surface-neutral appearance. Each surface picks the field it needs. */
export interface CellAppearance {
  /** Resolved template color for this position, '#RRGGBB'. */
  color: string
  /** Echoed classification, for state-specific structural rendering. */
  kind: CellKind
  /** On-screen CSS background — the exact string the live grid uses. */
  background: string
  /** Opaque hex fill for static export/print surfaces (Excel, PDF/HTML), '#RRGGBB'. */
  fill: string
  /** Accent text color (the template color) for the role label, '#RRGGBB'. */
  accent: string
}

/**
 * Resolve the template color for a (column, row) position. Mirrors the
 * on-screen `getColor` switch exactly.
 */
export function resolveTemplateColor(
  colorConfig: ColorConfig,
  columnColor: string,
  rowId: string,
): string {
  if (colorConfig.by === 'day') return columnColor
  if (colorConfig.by === 'shift') return colorConfig.map[rowId] ?? columnColor
  return columnColor
}

/**
 * Resolve the full appearance of a schedule cell. Pure: no side effects, no
 * surface-specific state. The same call on every surface guarantees the three
 * outputs agree on color.
 */
export function resolveCellAppearance(input: CellAppearanceInput): CellAppearance {
  const { colorConfig, columnColor, rowId, kind } = input
  const color = resolveTemplateColor(colorConfig, columnColor, rowId)

  let background: string
  let fill: string
  if (kind === 'closed') {
    background = CLOSED_BG_CSS
    fill = CLOSED_FILL_HEX
  } else if (kind === 'empty') {
    background = EMPTY_BG_CSS
    fill = EMPTY_FILL_HEX
  } else {
    // filled | partial | gap — all carry the day/shift tint on-screen.
    background = hexWithAlpha(color, CELL_TINT_ALPHA)
    fill = blendOnWhite(color, CELL_TINT_ALPHA)
  }

  return { color, kind, background, fill, accent: color }
}

// ── Color utilities (shared so every surface blends identically) ──────────────

/** Append an alpha byte to a '#RRGGBB' hex → '#RRGGBBAA' (CSS 8-digit hex). */
export function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(clamp01(alpha) * 255).toString(16).padStart(2, '0')
  return `${hex}${a}`
}

/**
 * Blend a '#RRGGBB' color onto white at `alpha`, returning an OPAQUE '#RRGGBB'.
 * This is the print/export equivalent of laying `hexWithAlpha(hex, alpha)` over
 * a white page, so a faint on-screen tint becomes a real light fill.
 */
export function blendOnWhite(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex)
  const t = clamp01(alpha)
  const mix = (c: number) => Math.round(c * t + 255 * (1 - t))
  return rgbToHex(mix(r), mix(g), mix(b))
}

/** Convert a '#RRGGBB' hex to an exceljs ARGB string 'FFRRGGBB' (opaque). */
export function hexToArgb(hex: string): string {
  const { r, g, b } = parseHex(hex)
  const h = (c: number) => c.toString(16).padStart(2, '0').toUpperCase()
  return `FF${h(r)}${h(g)}${h(b)}`
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
