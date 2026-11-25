export const productName = 'Catch-all Desk';

/**
 * The logo files in `public/brand/` are raster drafts. When final vector
 * artwork arrives, replace the files in place (see the README there); every
 * surface draws the logo through the components below.
 */

/** One-line logo with white lettering, for the blue surfaces. */
export function LogoOnBrand({ className = '' }: { className?: string }) {
  return (
    // A plain image: the file is tiny and must not wait on the image pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`logo-on-brand ${className}`.trim()}
      src="/brand/logo-on-dark.png"
      alt={productName}
      width={288}
      height={49}
    />
  );
}

/**
 * One-line logo with navy lettering, for light surfaces (the mobile top bar,
 * the white sign-in card). In the Midnight theme it swaps to the white-lettered
 * file so the name stays readable on the dark background.
 */
export function LogoOnLight({ className = '' }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`logo-on-light ${className}`.trim()}
        src="/brand/logo-on-light.png"
        alt={productName}
        width={288}
        height={49}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`logo-on-light-dark ${className}`.trim()}
        src="/brand/logo-on-dark.png"
        alt=""
        aria-hidden="true"
        width={288}
        height={49}
      />
    </>
  );
}

/** The name as text, for places too small or too plain for the logo. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()}>{productName}</span>;
}
