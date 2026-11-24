export const productName = 'Catchall Desk';

/**
 * Text wordmark used until logo files are supplied. When they arrive, put
 * them in `public/brand/` (see the README there) and render the logo here so
 * every surface picks it up.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()}>{productName}</span>;
}
