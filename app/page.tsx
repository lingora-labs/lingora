export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(2.5rem,6vw,5rem)', fontWeight: 400, letterSpacing: '-0.03em', background: 'linear-gradient(135deg,#fff 40%,#00c9a7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '1rem' }}>
        LINGORA
      </h1>
      <p style={{ fontSize: '1.15rem', color: 'rgba(255,255,255,.55)', maxWidth: '480px', lineHeight: 1.7, marginBottom: '2.5rem' }}>
        Learn Spanish. Live the culture.<br />
        Conversational AI that turns progress into real-world cultural immersion.
      </p>
      <a href="/beta" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#00c9a7', color: '#080f1f', fontWeight: 700, fontSize: '15px', padding: '14px 32px', borderRadius: '999px', textDecoration: 'none', letterSpacing: '.02em' }}>
        Try the AI Tutor
      </a>
      <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'rgba(255,255,255,.25)' }}>
        v10.0 · Vercel · Next.js App Router
      </p>
    </main>
  )
}
