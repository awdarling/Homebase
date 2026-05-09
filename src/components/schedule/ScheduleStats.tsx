'use client'

import type { Schedule } from '@/lib/types'

interface ScheduleStatsProps {
  schedule: Schedule
  compact?: boolean
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function coverageColor(rate: number): string {
  if (rate >= 90) return '#16a34a'
  if (rate >= 75) return '#ca8a04'
  return '#ef4444'
}

function coverageBg(rate: number): string {
  if (rate >= 90) return 'rgba(34,197,94,0.1)'
  if (rate >= 75) return 'rgba(234,179,8,0.1)'
  return 'rgba(239,68,68,0.1)'
}

function coverageBorder(rate: number): string {
  if (rate >= 90) return 'rgba(34,197,94,0.25)'
  if (rate >= 75) return 'rgba(234,179,8,0.25)'
  return 'rgba(239,68,68,0.25)'
}

export default function ScheduleStats({ schedule, compact = false }: ScheduleStatsProps) {
  const report = schedule.staffing_report
  const gaps = schedule.data?.gaps ?? []
  const totalGaps = gaps.length

  const coverageRate = report?.coverage_rate ?? null
  const topContributors = report?.top_contributors?.slice(0, 3) ?? []
  const totalWages = report?.estimated_wages?.total_estimated ?? null

  const weekLabel = `${formatDate(schedule.week_start)} – ${formatDate(schedule.week_end)}`

  const gap = compact ? 8 : 12
  const padding = compact ? '6px 12px' : '10px 16px'
  const labelSize = compact ? 9 : 10
  const valueSize = compact ? 13 : 16

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      gap,
      flexWrap: 'wrap',
    }}>

      {/* Week label */}
      <div style={{
        padding,
        background: 'var(--bg-surface-1)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}>
        <div style={{ fontSize: labelSize, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>
          Week
        </div>
        <div style={{ fontSize: valueSize, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, whiteSpace: 'nowrap' }}>
          {weekLabel}
        </div>
      </div>

      {/* Coverage rate */}
      {coverageRate !== null && (
        <div style={{
          padding,
          background: coverageBg(coverageRate),
          border: `1px solid ${coverageBorder(coverageRate)}`,
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 2,
        }}>
          <div style={{ fontSize: labelSize, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>
            Coverage
          </div>
          <div style={{ fontSize: valueSize, fontFamily: 'var(--font-display)', fontWeight: 800, color: coverageColor(coverageRate), lineHeight: 1 }}>
            {coverageRate}%
          </div>
        </div>
      )}

      {/* Gaps */}
      <div style={{
        padding,
        background: totalGaps > 0 ? 'rgba(239,68,68,0.08)' : 'var(--bg-surface-1)',
        border: `1px solid ${totalGaps > 0 ? 'rgba(239,68,68,0.2)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}>
        <div style={{ fontSize: labelSize, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>
          Gaps
        </div>
        <div style={{
          fontSize: valueSize,
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          color: totalGaps > 0 ? '#ef4444' : '#16a34a',
          lineHeight: 1,
        }}>
          {totalGaps}
        </div>
      </div>

      {/* Top contributors */}
      {topContributors.length > 0 && (
        <div style={{
          padding,
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: compact ? 3 : 4,
        }}>
          <div style={{ fontSize: labelSize, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>
            Top Staff
          </div>
          <div style={{ display: 'flex', gap: compact ? 8 : 12, flexWrap: 'wrap' }}>
            {topContributors.map((c) => (
              <div key={c.employee_id} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: compact ? 11 : 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}>
                  {c.name}
                </span>
                <span style={{ fontSize: compact ? 10 : 11, color: 'var(--accent)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                  {c.hours}h
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estimated wages */}
      {totalWages !== null && (
        <div style={{
          padding,
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 2,
        }}>
          <div style={{ fontSize: labelSize, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>
            Est. Wages
          </div>
          <div style={{ fontSize: valueSize, fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
            ${totalWages.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
        </div>
      )}

    </div>
  )
}
