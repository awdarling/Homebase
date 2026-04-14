'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/',         label: 'Home' },
  { href: '/data',     label: 'Data' },
  { href: '/rules',    label: 'Rules' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/activity', label: 'Activity' },
  { href: '/profile',  label: 'Profile' },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 'var(--nav-height)',
      background: 'var(--bg-surface-1)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      zIndex: 100,
    }}>

      {/* Left: Brand */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.12em',
          color: 'var(--text-primary)',
          lineHeight: 1,
        }}>
          QURIA <span style={{ color: 'var(--accent)' }}>SOLUTIONS</span>
        </span>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          color: 'var(--text-muted)',
          letterSpacing: '0.05em',
          lineHeight: 1,
        }}>
          Watermark Country Club's Homebase
        </span>
      </div>

      {/* Center: Navigation links */}
      <div style={{ display: 'flex', gap: 2 }}>
        {NAV_LINKS.map(({ href, label }) => {
          const isActive = href === '/'
            ? pathname === '/'
            : pathname.startsWith(href)

          return (
            <Link
              key={href}
              href={href}
              style={{
                padding: '6px 16px',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontFamily: 'var(--font-body)',
                fontWeight: isActive ? 500 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                background: isActive ? 'var(--bg-surface-3)' : 'transparent',
                transition: 'color 0.15s, background 0.15s',
                letterSpacing: '0.01em',
              }}
            >
              {label}
            </Link>
          )
        })}
      </div>

      {/* Right: Status indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--status-ready-text)',
        }} />
        <span style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-body)',
        }}>
          System Ready
        </span>
      </div>

    </nav>
  )
}
