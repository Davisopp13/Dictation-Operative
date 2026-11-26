import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/** Imported only in the browser. No document bytes or assets go to a CDN. */
export async function pdfRuntime() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = `/vendor/pdfjs/${pdfjs.version}/`;
  pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
  return { pdfjs, assets };
}

export const PRINT_PAGE_LIMIT = 20;
export const PRINT_PIXEL_LIMIT = 40_000_000;

export function printRange(first: number, last: number, count: number) {
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    first < 1 ||
    last < first ||
    last > count
  )
    throw new Error(`Choose a page range between 1 and ${count}.`);
  if (last - first + 1 > PRINT_PAGE_LIMIT)
    throw new Error(
      `Print up to ${PRINT_PAGE_LIMIT} pages at a time, or download the PDF to print it in another app.`,
    );
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** Bound canvas allocation even for PDFs with enormous page dimensions. */
export function pageViewport(
  page: PDFPageProxy,
  desiredScale: number,
  maxPixels = 4_000_000,
) {
  const unit = page.getViewport({ scale: 1 });
  const scale = Math.min(
    desiredScale,
    Math.sqrt(maxPixels / (unit.width * unit.height)),
    8192 / Math.max(unit.width, unit.height),
  );
  return page.getViewport({ scale });
}

export type PrintPage = { url: string; width: number; height: number };
export async function preparePdfPrint(
  pdf: PDFDocumentProxy,
  first: number,
  last: number,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<PrintPage[]> {
  const pages = printRange(first, last, pdf.numPages);
  const result: PrintPage[] = [];
  let pixels = 0;
  try {
    for (const number of pages) {
      signal.throwIfAborted();
      progress(`Preparing page ${number} of ${last}…`);
      const page = await pdf.getPage(number);
      signal.throwIfAborted();
      const unit = page.getViewport({ scale: 1 });
      const viewport = pageViewport(page, 2);
      pixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
      if (pixels > PRINT_PIXEL_LIMIT)
        throw new Error(
          'This print job is too large for the browser. Choose fewer pages, or download the PDF to print it in another app.',
        );
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const render = page.render({
        canvas,
        viewport,
        intent: 'print',
        annotationMode: 0,
      });
      const cancel = () => render.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        await render.promise;
        signal.throwIfAborted();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(
                    new Error(
                      'This page could not be prepared. Try downloading the PDF.',
                    ),
                  ),
            'image/png',
          ),
        );
        signal.throwIfAborted();
        result.push({
          url: URL.createObjectURL(blob),
          width: unit.width,
          height: unit.height,
        });
      } finally {
        signal.removeEventListener('abort', cancel);
        canvas.width = canvas.height = 0;
      }
    }
    return result;
  } catch (error) {
    result.forEach((page) => URL.revokeObjectURL(page.url));
    throw error;
  }
}
