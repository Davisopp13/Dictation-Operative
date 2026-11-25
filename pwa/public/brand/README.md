# Catch-all Desk brand assets

- `logo-on-dark.png`: one-line logo in white on a transparent background, for
  the blue surfaces only (the sidebar header).
- `logo-stacked.png`: two-line logo in navy on white, shown inside a white
  card (sign-in and the other small pages).

Both are raster drafts, downscaled from the design session's artwork. Replace
them in place with final artwork, ideally SVG; they are drawn only through
`components/do/wordmark.tsx`, so that is the one file to change if the
filenames or formats change.

The installed-app icons in `public/icons/` (`icon-192.png`, `icon-512.png`,
`apple-touch-icon.png`) and `public/favicon.svg` still carry the previous
artwork. Replace them in place, keeping the same filenames and pixel sizes, so
the manifest and existing installs keep working. The square app icon is for
the home screen only and is not repeated inside the app.
