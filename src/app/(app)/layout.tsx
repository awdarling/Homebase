import Nav from '@/components/layout/Nav'
import SoteriaPanel from '@/components/layout/SoteriaPanel'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Nav />
      <main style={{ paddingTop: 'var(--nav-height)' }}>
        {children}
      </main>
      <SoteriaPanel />
    </>
  )
}
