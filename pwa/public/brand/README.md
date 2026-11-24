# Catchall Desk brand assets

Reserved for the Catchall Desk logo. The app shows a text wordmark
(`components/do/wordmark.tsx`) until these files exist.

Expected files:

- `logo.svg`: full logo for light backgrounds
- `logo-dark.svg`: full logo for dark backgrounds
- `mark.svg`: square mark without the name

The installed-app icons in `public/icons/` (`icon-192.png`, `icon-512.png`,
`apple-touch-icon.png`) and `public/favicon.svg` still carry the previous
artwork. Replace them in place, keeping the same filenames and pixel sizes, so
the manifest and existing installs keep working.
