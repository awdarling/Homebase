'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const NAV_LINKS = [
  { href: '/',         label: 'Home' },
  { href: '/data',     label: 'Data' },
  { href: '/rules',    label: 'Rules' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/activity', label: 'Activity' },
  { href: '/profile',  label: 'Profile' },
  { href: '/billing',  label: 'Billing' },
]

interface UserProfile {
  name: string
  email: string
  avatar_url: string | null
  role: string
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    fetchUser()
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchUser() {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return
    const { data } = await supabase
      .from('users')
      .select('name, email, avatar_url, role')
      .eq('id', authUser.id)
      .single()
    if (data) setUser(data)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

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

      {/* Right: Avatar dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 10px 4px 4px',
            cursor: 'pointer',
          }}
        >
          {/* Avatar */}
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: user?.avatar_url ? 'transparent' : 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>
                {initials}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
            {user?.name ?? 'Account'}
          </span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {dropdownOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 200,
            background: 'var(--bg-surface-1)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            zIndex: 200,
          }}>
            {/* User info */}
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {user?.name ?? '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {user?.email ?? '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {user?.role ?? '—'}
              </div>
            </div>

            {/* Menu items */}
            <Link
              href="/account"
              onClick={() => setDropdownOpen(false)}
              style={{
                display: 'block',
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-body)',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background 0.15s',
              }}
            >
              Account Settings
            </Link>

            <Link
              href="/access"
              onClick={() => setDropdownOpen(false)}
              style={{
                display: 'block',
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-body)',
                borderBottom: '1px solid var(--border-subtle)',
                transition: 'background 0.15s',
              }}
            >
              Access Management
            </Link>

            <button
              onClick={handleSignOut}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--status-blocked-text)',
                fontFamily: 'var(--font-body)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}