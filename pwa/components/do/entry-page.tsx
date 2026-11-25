import type { ReactNode } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './theme';
import { Wordmark } from './wordmark';

/** Shared frame for the small pages outside the signed-in workspace. */
export function EntryPage({ title, description, icon, children }: {
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="entry-page">
      <div className="entry-shell">
        <header className="entry-header">
          <Link className="entry-brand" href="/" aria-label="Catchall Desk home">
            <span><Wordmark /><span className="entry-brand-label">Clipboard and documents across devices</span></span>
          </Link>
          <ThemeToggle />
        </header>
        <section className="entry-card" aria-labelledby="entry-title">
          {icon && <div className="entry-icon" aria-hidden="true">{icon}</div>}
          <h1 id="entry-title">{title}</h1>
          <p className="entry-description">{description}</p>
          <div className="entry-content">{children}</div>
        </section>
        <footer className="entry-footer">
          <span>Paste, upload, or scan in. Copy, share, or print out.</span>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
