import type { ReactNode } from 'react';

/**
 * A screen's heading: the title sitting on a short blue bar the width of the
 * word, a small tilted card beside it, and one line of explanation. `aside`
 * holds the screen's main controls, level with the title on wide screens.
 */
export function ScreenTitle({
  title,
  subtitle,
  accent,
  aside,
}: {
  title: string;
  subtitle: string;
  accent: 'mint' | 'page' | 'sticky';
  aside?: ReactNode;
}) {
  return (
    <header className="screen-head">
      <div className="screen-head-text">
        <div className="screen-title-row">
          <div className="screen-title">
            <h1>{title}</h1>
            <span className="screen-title-bar" aria-hidden="true" />
          </div>
          <span className={`title-accent title-accent-${accent}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        <p>{subtitle}</p>
      </div>
      {aside && <div className="screen-head-aside">{aside}</div>}
    </header>
  );
}
