import { Link, useLocation } from 'react-router-dom'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation()

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/creators', label: 'Creators' },
    { path: '/moderation', label: 'Moderation' },
    { path: '/audit-log', label: 'Audit Log' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 240, background: 'var(--card)', borderRight: '1px solid var(--border)', padding: '1.5rem 1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '2rem' }}>PokeSniper Admin</h1>
        <ul style={{ listStyle: 'none' }}>
          {navItems.map((item) => (
            <li key={item.path} style={{ marginBottom: '0.5rem' }}>
              <Link
                to={item.path}
                style={{
                  display: 'block',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: location.pathname === item.path ? 'var(--accent)' : 'transparent',
                  color: location.pathname === item.path ? 'white' : 'var(--text)',
                  textDecoration: 'none',
                  fontWeight: location.pathname === item.path ? 600 : 400,
                }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}
