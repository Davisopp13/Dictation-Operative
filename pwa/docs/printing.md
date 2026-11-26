# Web PDF preview and printing

Implemented locally November 25, 2026 on root branch `codex/web-print-pdf-preview`, based on `7d8ee82`. No deployment or migration.

Choose **View** on a PDF in Documents to read it one page at a time. Previous/Next, Fit width, 150%, 200%, and expandable page text are available. Choose **Print…**, enter the first and last pages, **Prepare pages**, then **Print**. The system print dialog selects the printer and copies. Browser-added headers and footers are controlled by that dialog.

Saved Clipboard text has **Print** in its More actions menu; it prints the current editor draft without saving changes. Image previews in Clipboard and Documents have **Print**. Text and image print panels offer US Letter or A4 and an original download fallback. PDFs use their source page dimensions. Office files and Google shortcuts retain their existing download/open behavior.

PDF preview uses pinned PDF.js 6.5.438, loaded only when a PDF is opened. The worker, character maps, standard fonts, ICC data and WASM are served locally from versioned assets. `npm run dev` and `npm run build` prepare these assets from the installed package; `npm run deploy` calls the build script. Generated assets are ignored by Git. Use these scripts rather than calling `vinext build` directly. Private document responses and the service-worker caching policy are unchanged.

The renderer fetches the authenticated attachment bytes with no-store. No PDF is made public or sent to an external viewer. Preview canvases are limited to 4 million pixels and 8192 pixels on either dimension. Switching pages cancels the previous render; closing the preview aborts fetches and destroys the PDF worker task. Resizing rerenders the page to fit its container.

Printing uses a separate same-origin HTML iframe, populated with React text and locally prepared image pages. It does not copy the workspace HTML, execute document scripts, or interpolate saved text as HTML. This isolation also prevents dialog scroll locks and app layout from adding blank pages. PDF pages render sequentially, normally at 144 DPI, with a maximum of 20 pages and 40 million combined pixels per print preparation. Oversized jobs ask for a smaller range or an external PDF app. Generated object URLs and canvases are released when discarded or closed.

PDF preview and browser PDF printing are static raster renditions. Interactive forms, links, and annotations are not included; the interface directs users to download the original for those features or original vector print quality. Password-protected and invalid PDFs retain the download action and show an explanation. The app does not claim that a physical print job succeeded merely because a dialog closed.

Validation performed against isolated local D1/R2 with synthetic content:

- Typecheck, lint, production build and 137 tests, including print-range rejection and bounded canvas sizing.
- Built Content Worker checks for authenticated streaming, owner isolation, retention, deletion and session revocation.
- Chrome PDF rendering, page navigation, zoom, 390px layout, malformed-file error, and invalid print range.
- Native Chrome print dialog: three-page PDF produced exactly three pages; image and text each produced one page. Literal HTML-like text and Unicode were preserved as text. A discovered HP printer appeared in the system dialog; every job was canceled before printing.

Physical printer output, Safari, Firefox, real iPhone/Android browsers, installed-PWA printing and assistive-technology behavior remain real-device acceptance checks. No external scanner integration is included.
