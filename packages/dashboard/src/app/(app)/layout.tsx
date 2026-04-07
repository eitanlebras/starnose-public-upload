export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        padding: '12px 24px',
        borderBottom: '1px solid #2A2A2A',
        fontSize: '12px',
      }}>
        <a href="/" style={{ color: '#9D7F8C', fontWeight: 600, fontSize: '14px', textDecoration: 'none' }}>
          starnose
        </a>
        <a href="/dashboard" style={{ color: '#A0A0A0', textDecoration: 'none' }}>live</a>
        <a href="/sessions" style={{ color: '#A0A0A0', textDecoration: 'none' }}>sessions</a>
      </nav>
      <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {children}
      </main>
    </>
  );
}
