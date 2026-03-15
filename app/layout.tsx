import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'LINGORA — Cultural Immersion Platform for Spanish',
  description: 'Conversational AI that turns progress into real-world cultural immersion.',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#080f1f',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#080f1f', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
