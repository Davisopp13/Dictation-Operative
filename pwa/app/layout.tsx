import type { Metadata, Viewport } from 'next';
// Fonts are bundled with the app, so no page load asks a font service for
// anything. They are imported here, not from the stylesheet, so the build
// copies the font files and rewrites their addresses.
import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/nunito/wght.css';
import './globals.css';
import './desk.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a5ce6' },
    { media: '(prefers-color-scheme: dark)', color: '#071a44' },
  ],
};

export const metadata: Metadata = {
  title: 'Catch-all Desk',
  description: 'Move text, images, and documents between your devices.',
  icons: { icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Catch-all Desk', statusBarStyle: 'default' },
};

// Applied before first paint so the page never flashes the wrong theme.
const themeScript = `(function(){try{
var s=localStorage.getItem('do-theme')||'system';
var d=s==='dark'||(s==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Send cookies with the manifest request so protected previews can serve it. */}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
