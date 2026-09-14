import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from './theme';

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
          <Link className="entry-brand" href="/" aria-label="Dictation Operative home">
            <Image src="/icons/icon-192.png" alt="" width={48} height={48} unoptimized />
            <span>Dictation Operative<span className="entry-brand-label">Voice workspace</span></span>
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
          <span>Capture thoughts. Shape your words.</span>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
