'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrintControls } from './document-print';
import { pdfRuntime, pageViewport } from '@/lib/pdf';

export function PdfPreview({ url, name }: { url: string; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [number, setNumber] = useState(1),
    [zoom, setZoom] = useState(1);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false),
    [printing, setPrinting] = useState(false);
  const [text, setText] = useState('');
  const [retry, setRetry] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  useEffect(() => {
    const host = surface.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setSurfaceWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'Sign in again to preview this PDF.'
            : 'This PDF could not be loaded. It may have been removed.',
        );
      const data = new Uint8Array(await response.arrayBuffer());
      const { pdfjs, assets } = await pdfRuntime();
      controller.signal.throwIfAborted();
      task = pdfjs.getDocument({
        data,
        cMapUrl: `${assets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`,
        wasmUrl: `${assets}wasm/`,
        iccUrl: `${assets}iccs/`,
      });
      const document = await task.promise;
      if (!controller.signal.aborted) setPdf(document);
    })()
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e?.name === 'PasswordException'
              ? 'This PDF is password protected. Download it to open it in a PDF app.'
              : e?.name === 'InvalidPDFException'
                ? 'This file could not be read as a PDF. Download the original to check it.'
                : 'The PDF preview could not load. Retry, or download the original file.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      void task?.destroy();
    };
  }, [url, retry]);

  useEffect(() => {
    if (!pdf || !surface.current) return;
    const host = surface.current;
    let active = true;
    let render: RenderTask | undefined;
    let canvas: HTMLCanvasElement | undefined;
    void (async () => {
      const page = await pdf.getPage(number);
      if (!active) return;
      setRendering(true);
      setText('');
      setError('');
      const base = page.getViewport({ scale: 1 });
      const displayWidth =
        Math.min(760, Math.max(240, host.clientWidth)) * zoom;
      const scale = displayWidth / base.width;
      const viewport = pageViewport(
        page,
        scale * Math.min(window.devicePixelRatio || 1, 2),
      );
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${(displayWidth * base.height) / base.width}px`;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute(
        'aria-label',
        `${name}, page ${number} of ${pdf.numPages}`,
      );
      host.replaceChildren(canvas);
      render = page.render({ canvas, viewport, annotationMode: 0 });
      await render.promise;
      const content = await page.getTextContent();
      if (active)
        setText(
          content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' '),
        );
    })()
      .catch((e) => {
        if (active && e?.name !== 'RenderingCancelledException')
          setError(
            'This page could not be displayed. Try another page or download the original PDF.',
          );
      })
      .finally(() => {
        if (active) setRendering(false);
      });
    return () => {
      active = false;
      render?.cancel();
      // The next render uses its own canvas; cancellation cannot race it.
      if (canvas) {
        canvas.remove();
        canvas.width = canvas.height = 0;
      }
    };
  }, [pdf, number, zoom, name, surfaceWidth]);

  return (
    <div className="pdf-preview">
      {loading && <output>Loading PDF…</output>}
      {error && (
        <div role="alert" className="content-error">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setError('');
              setPdf(null);
              setPrinting(false);
              setNumber(1);
              setRetry((value) => value + 1);
            }}
          >
            Retry preview
          </Button>
        </div>
      )}
      {pdf && (
        <>
          <div className="pdf-toolbar" aria-label="PDF controls">
            <Button
              variant="outline"
              aria-label="Previous page"
              disabled={number <= 1}
              onClick={() => setNumber((value) => value - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span aria-live="polite">
              Page {number} of {pdf.numPages}
            </span>
            <Button
              variant="outline"
              aria-label="Next page"
              disabled={number >= pdf.numPages}
              onClick={() => setNumber((value) => value + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <label>
              Zoom
              <select
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                <option value={1}>Fit width</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </label>
            <Button
              variant="outline"
              aria-expanded={printing}
              onClick={() => setPrinting((value) => !value)}
            >
              <Printer aria-hidden="true" /> Print…
            </Button>
          </div>
          {printing && (
            <PrintControls source={{ kind: 'pdf', pdf }} name={name} />
          )}
        </>
      )}
      {rendering && <output>Rendering page…</output>}
      <div className="pdf-page-surface" ref={surface} aria-busy={rendering} />
      {text && (
        <details className="pdf-page-text">
          <summary>Page text</summary>
          <p>{text}</p>
        </details>
      )}
      <p className="subtle">
        Preview of the saved PDF. Download the original to use links, forms,
        annotations, or a full PDF reader.
      </p>
    </div>
  );
}
