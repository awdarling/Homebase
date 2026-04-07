import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/layout/Nav'

export const metadata: Metadata = {
  title: 'Homebase — Quria Solutions',
  description: 'The operating platform for your AI employees.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main style={{ paddingTop: 'var(--nav-height)' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
