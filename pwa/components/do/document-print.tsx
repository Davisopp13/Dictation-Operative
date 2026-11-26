'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { download, errorMessage } from '@/lib/client';
import { preparePdfPrint, type PrintPage } from '@/lib/pdf';

type Source =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; pdf: PDFDocumentProxy };

// A separate HTML document keeps app dialogs, scroll locks and themes out of print.
// No user HTML is interpolated: content below is rendered as React text or images.
const PRINT_FRAME = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; color: black; background: white; }
body { font: 12pt/1.5 Arial, sans-serif; }
* { box-sizing: border-box; }
.document-print-text h1 { font-size: 18pt; margin: 0 0 12pt; }
.document-print-text > div { white-space: pre-wrap; overflow-wrap: anywhere; }
.document-print-image { display: block; width: 100%; object-fit: contain; margin: 0 auto; }
.document-print-page { break-inside: avoid; overflow: hidden; line-height: 0; }
.document-print-page + .document-print-page { break-before: page; }
.document-print-page img { display: block; width: 100%; height: 100%; }
</style></head><body></body></html>`;

/** Print only a prepared document, never the surrounding workspace. */
export function PrintControls({
  source,
  name,
}: {
  source: Source;
  name: string;
}) {
  const [first, setFirst] = useState(1),
    [last, setLast] = useState(source.kind === 'pdf' ? source.pdf.numPages : 1);
  const [pages, setPages] = useState<PrintPage[]>([]);
  const [ready, setReady] = useState(source.kind === 'text');
  const [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const [printBody, setPrintBody] = useState<HTMLElement | null>(null);
  const [paper, setPaper] = useState('letter');
  const operation = useRef<AbortController | null>(null);
  const urls = useRef<PrintPage[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    return () => {
      operation.current?.abort();
      urls.current.forEach((page) => URL.revokeObjectURL(page.url));
    };
  }, []);
  const invalidate = () => {
    operation.current?.abort();
    urls.current.forEach((page) => URL.revokeObjectURL(page.url));
    urls.current = [];
    setPages([]);
    setReady(false);
    setError('');
  };
  const prepare = async () => {
    if (source.kind !== 'pdf' || operation.current) return;
    invalidate();
    const controller = new AbortController();
    operation.current = controller;
    setStatus('Preparing pages…');
    try {
      const result = await preparePdfPrint(
        source.pdf,
        first,
        last,
        controller.signal,
        setStatus,
      );
      if (controller.signal.aborted) {
        result.forEach((page) => URL.revokeObjectURL(page.url));
        return;
      }
      urls.current = result;
      setPages(result);
      // Images are decoded by the print portal before enabling Print.
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setStatus('');
      operation.current = null;
    }
  };
  useEffect(() => {
    if (!printBody || source.kind === 'text') return;
    let active = true;
    const images = Array.from(root.current?.querySelectorAll('img') ?? []);
    if (!images.length) return;
    void Promise.all(images.map((image) => image.decode()))
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            'The image could not load. Download the original file and print it from another app.',
          );
      });
    return () => {
      active = false;
    };
  }, [printBody, pages, source.kind]);
  const print = () => {
    const target = frame.current?.contentWindow;
    if (!ready || !target || !printBody) return;
    target.document.title = name;
    try {
      target.focus();
      target.print();
    } catch {
      setError(
        'Printing is unavailable here. Download the file and print it from another app.',
      );
    }
  };
  const width = paper === 'a4' ? 595.28 : 612;
  const height = paper === 'a4' ? 841.89 : 792;
  return (
    <div className="document-print-controls">
      {source.kind === 'pdf' ? (
        <>
          <div className="document-page-range">
            <label>
              From page
              <input
                type="number"
                min={1}
                max={source.pdf.numPages}
                value={first}
                disabled={!!status}
                onChange={(e) => {
                  invalidate();
                  setFirst(Number(e.target.value));
                }}
              />
            </label>
            <label>
              To page
              <input
                type="number"
                min={first}
                max={source.pdf.numPages}
                value={last}
                disabled={!!status}
                onChange={(e) => {
                  invalidate();
                  setLast(Number(e.target.value));
                }}
              />
            </label>
            <Button
              variant="outline"
              disabled={!!status}
              onClick={() => void prepare()}
            >
              Prepare pages
            </Button>
          </div>
          <p className="subtle">
            Prepare a range, then print. For the original PDF quality, download
            and print in a PDF app. Interactive form fields and annotations are
            not included in this preview.
          </p>
        </>
      ) : (
        <label className="document-paper">
          Paper size
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            <option value="letter">US Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
      )}
      {status && <output>{status}</output>}
      {error && (
        <p role="alert" className="content-error">
          {error}
        </p>
      )}
      <Button disabled={!ready || !printBody || !!status} onClick={print}>
        <Printer aria-hidden="true" /> Print
      </Button>
      <p className="subtle">
        Choose your printer in the system dialog. If it does not open, use
        Download and print from another app.
      </p>
      <iframe
        ref={frame}
        title="Prepared print document"
        className="document-print-frame"
        aria-hidden="true"
        tabIndex={-1}
        srcDoc={PRINT_FRAME}
        onLoad={() =>
          setPrintBody(frame.current?.contentDocument?.body ?? null)
        }
      />
      {printBody &&
        createPortal(
          <div id="document-print-root" ref={root} aria-hidden="true">
            <style>{`@media print { @page { size: ${width}pt ${height}pt; margin: 36pt; } ${pages.map((page, index) => `@page document${index} { size: ${page.width}pt ${page.height}pt; margin: 0; }`).join(' ')} }`}</style>
            {source.kind === 'text' ? (
              <article className="document-print-text">
                <h1>{name}</h1>
                <div>{source.text}</div>
              </article>
            ) : source.kind === 'image' ? (
              /* Images come only from authenticated app endpoints or our own blob URLs. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="document-print-image"
                src={source.url}
                alt=""
                style={{ maxHeight: `${height - 72}pt` }}
              />
            ) : (
              pages.map((page, index) => (
                <div
                  className="document-print-page"
                  key={page.url}
                  style={{
                    page: `document${index}`,
                    width: `${page.width}pt`,
                    height: `${page.height}pt`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={page.url} alt="" />
                </div>
              ))
            )}
          </div>,
          printBody,
        )}
    </div>
  );
}

export function DocumentPrintButton({
  name,
  source,
}: {
  name: string;
  source: Exclude<Source, { kind: 'pdf' }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Printer aria-hidden="true" /> Print
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="document-preview-dialog">
          <DialogTitle>Print {name}</DialogTitle>
          <DialogDescription>Only this item will be printed.</DialogDescription>
          <div className="document-print-preview">
            {source.kind === 'text' ? (
              <div className="document-text-preview">{source.text}</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={source.url} alt={name} />
            )}
          </div>
          {open && <PrintControls source={source} name={name} />}
          {source.kind === 'text' ? (
            <Button
              variant="outline"
              onClick={() => download(`${name}.txt`, source.text)}
            >
              Download text
            </Button>
          ) : (
            <a className="text-link" href={`${source.url}?download=1`} download>
              Download original image
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
