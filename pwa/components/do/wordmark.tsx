export const productName = 'Catch-all Desk';

/**
 * The logo files in `public/brand/` are raster drafts. When final vector
 * artwork arrives, replace the files in place (see the README there); every
 * surface draws the logo through the two components below.
 */

/** One-line logo in white, for the blue surfaces only. */
export function LogoOnBrand({ className = '' }: { className?: string }) {
  return (
    // A plain image: the file is tiny and must not wait on the image pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`logo-on-brand ${className}`.trim()}
      src="/brand/logo-on-dark.png"
      alt={productName}
      width={288}
      height={54}
    />
  );
}

/** Two-line logo in navy, always shown inside a white card. */
export function LogoStacked({ className = '' }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`logo-stacked ${className}`.trim()}
      src="/brand/logo-stacked.png"
      alt={productName}
      width={256}
      height={126}
    />
  );
}

/** The name as text, for places too small or too plain for the logo. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()}>{productName}</span>;
}
