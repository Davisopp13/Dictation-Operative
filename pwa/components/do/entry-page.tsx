import type { ReactNode } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './theme';
import { LogoStacked } from './wordmark';

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
          <Link className="entry-logo" href="/" aria-label="Catch-all Desk home">
            <LogoStacked />
          </Link>
          <ThemeToggle />
        </header>
        <p className="entry-tagline">
          Paste, type or upload on one device. Copy, share or download on
          another.
        </p>
        <section className="entry-card" aria-labelledby="entry-title">
          {icon && <div className="entry-icon" aria-hidden="true">{icon}</div>}
          <h1 id="entry-title">{title}</h1>
          <p className="entry-description">{description}</p>
          <div className="entry-content">{children}</div>
        </section>
        <footer className="entry-footer">
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
