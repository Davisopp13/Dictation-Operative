'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/client';
import { CONTENT_FILE_LIMIT } from '@/lib/content-model';
import {
  SCAN_PAGE_LIMIT,
  detectPage,
  enhance,
  flatten,
  isConvex,
  pageSize,
  pdfFromJpegs,
  scanFilename,
  wholePhoto,
  type Pixels,
  type Quad,
  type ScanFilter,
} from '@/lib/scan';

/** Longest side kept from the camera photo. Larger only costs memory. */
const SOURCE_PIXELS = 2600;
const DETECT_PIXELS = 320;
const corners = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const filters: { value: ScanFilter; label: string }[] = [
  { value: 'enhanced', label: 'Colour' },
  { value: 'bw', label: 'Black & white' },
  { value: 'original', label: 'Photo' },
];

type Draft = {
  /** The photo, upright, at working size. */
  source: HTMLCanvasElement;
  /** A small copy for detection and the live preview. */
  small: Pixels;
  url: string;
  found: boolean;
};
type Page = { id: number; blob: Blob; url: string };

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot process photos.');
  return { element, context };
}
const jpeg = (element: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    element.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The page could not be saved as an image.')),
      'image/jpeg',
      quality,
    ),
  );
/** Lets the "working" message paint before a slow, blocking step. */
const paint = () => new Promise((resolve) => setTimeout(resolve, 40));

async function readPhoto(file: File): Promise<Draft> {
  const address = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = address;
    try {
      await image.decode();
    } catch {
      throw new Error(
        'That photo could not be opened. Try a JPEG or PNG picture.',
      );
    }
    // Drawing an <img> applies the camera's rotation, so the page is upright.
    const scale = Math.min(
      1,
      SOURCE_PIXELS / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const source = canvas(
      Math.max(1, Math.round(image.naturalWidth * scale)),
      Math.max(1, Math.round(image.naturalHeight * scale)),
    );
    source.context.drawImage(
      image,
      0,
      0,
      source.element.width,
      source.element.height,
    );
    const shrink = Math.min(
      1,
      DETECT_PIXELS / Math.max(source.element.width, source.element.height),
    );
    const small = canvas(
      Math.max(8, Math.round(source.element.width * shrink)),
      Math.max(8, Math.round(source.element.height * shrink)),
    );
    small.context.drawImage(
      source.element,
      0,
      0,
      small.element.width,
      small.element.height,
    );
    const pixels = small.context.getImageData(
      0,
      0,
      small.element.width,
      small.element.height,
    );
    return {
      source: source.element,
      small: pixels,
      url: URL.createObjectURL(await jpeg(source.element, 0.8)),
      found: false,
    };
  } finally {
    URL.revokeObjectURL(address);
  }
}

const scaled = (quad: Quad, width: number, height: number) =>
  quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;

/**
 * Photograph paper, mark its corners, and save the flattened pages as one PDF.
 * `onSave` resolves true once the PDF is in Documents; until then the pages
 * stay here so a failed upload can be retried.
 */
export function DocumentScanner({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    [quad, setQuad] = useState<Quad>(wholePhoto),
    [filter, setFilter] = useState<ScanFilter>('enhanced'),
    [pages, setPages] = useState<Page[]>([]),
    [name, setName] = useState(''),
    [working, setWorking] = useState(''),
    [error, setError] = useState(''),
    [leaving, setLeaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLCanvasElement>(null),
    nextId = useRef(1),
    held = useRef<string[]>([]);
  // Object URLs outlive renders; release them all when the scanner goes away.
  const hold = (url: string) => {
    held.current.push(url);
    return url;
  };
  const release = (url: string) => {
    URL.revokeObjectURL(url);
    held.current = held.current.filter((item) => item !== url);
  };
  useEffect(
    () => () => {
      held.current.forEach((url) => URL.revokeObjectURL(url));
      held.current = [];
    },
    [],
  );
  const reset = () => {
    held.current.forEach((url) => URL.revokeObjectURL(url));
    held.current = [];
    setDraft(null);
    setPages([]);
    setName('');
    setError('');
    setLeaving(false);
  };
  const today = new Date().toLocaleDateString('en-CA');

  const choose = async (file: File | undefined) => {
    if (!file || working) return;
    setError('');
    setWorking('Finding the page…');
    try {
      await paint();
      const next = await readPhoto(file);
      const detected = detectPage(next.small);
      hold(next.url);
      if (draft) release(draft.url);
      setDraft({ ...next, found: detected.found });
      setQuad(detected.quad);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking('');
    }
  };

  // A small live preview of the flattened, cleaned page.
  useEffect(() => {
    const target = preview.current;
    if (!draft || !target) return;
    const timer = setTimeout(() => {
      const context = target.getContext('2d');
      if (!context) return;
      if (!isConvex(quad)) {
        context.clearRect(0, 0, target.width, target.height);
        return;
      }
      const { width, height } = draft.small;
      const corners = scaled(quad, width, height);
      const size = pageSize(corners, 220);
      const page = enhance(
        flatten(draft.small, corners, size.width, size.height),
        filter,
      );
      target.width = page.width;
      target.height = page.height;
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(page.data),
          page.width,
          page.height,
        ),
        0,
        0,
      );
    }, 60);
    return () => clearTimeout(timer);
  }, [draft, quad, filter]);

  const move = (index: number, x: number, y: number) =>
    setQuad((current) => {
      const next = [...current] as Quad;
      next[index] = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
      return next;
    });
  const drag = (index: number, event: React.PointerEvent) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    move(
      index,
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
    );
  };

  const keep = async () => {
    if (!draft || working) return;
    if (!isConvex(quad)) {
      setError('Drag the corners so they outline the page.');
      return;
    }
    setError('');
    setWorking('Flattening the page…');
    try {
      await paint();
      const { width, height } = draft.source;
      const context = draft.source.getContext('2d', {
        willReadFrequently: true,
      });
      if (!context) throw new Error('This browser cannot process photos.');
      const corners = scaled(quad, width, height);
      const size = pageSize(corners);
      const page = enhance(
        flatten(
          context.getImageData(0, 0, width, height),
          corners,
          size.width,
          size.height,
        ),
        filter,
      );
      const out = canvas(page.width, page.height);
      out.context.putImageData(
        new ImageData(
          new Uint8ClampedArray(page.data),
          page.width,
          page.height,
        ),
        0,
        0,
      );
      const blob = await jpeg(out.element, 0.85);
      const added = {
        id: nextId.current++,
        blob,
        url: hold(URL.createObjectURL(blob)),
      };
      setPages((current) => [...current, added]);
      release(draft.url);
      setDraft(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking('');
    }
  };

  const save = async () => {
    if (!pages.length || working) return;
    setError('');
    setWorking('Saving to Documents…');
    try {
      await paint();
      const pdf = pdfFromJpegs(
        await Promise.all(
          pages.map(
            async (page) => new Uint8Array(await page.blob.arrayBuffer()),
          ),
        ),
      );
      if (pdf.length > CONTENT_FILE_LIMIT)
        throw new Error(
          'This scan is larger than 50 MB. Remove some pages and save them as a second scan.',
        );
      const file = new File([pdf], scanFilename(name || `Scan ${today}`), {
        type: 'application/pdf',
      });
      if (await onSave(file)) {
        reset();
        onClose();
      } else
        setError(
          'The scan was not saved. Your pages are still here: check your connection and try again.',
        );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking('');
    }
  };

  const photoInput = (label: string, camera: boolean) => (
    <label className={`scan-photo-control${camera ? ' is-primary' : ''}`}>
      {camera ? (
        <Camera aria-hidden="true" />
      ) : (
        <ImagePlus aria-hidden="true" />
      )}
      <span>{label}</span>
      <input
        aria-label={label}
        type="file"
        accept="image/*"
        capture={camera ? 'environment' : undefined}
        disabled={!!working}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void choose(file);
        }}
      />
    </label>
  );
  const full = pages.length >= SCAN_PAGE_LIMIT;

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (next || working) return;
        if (pages.length || draft) setLeaving(true);
        else {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="content-dialog scan-dialog sm:max-w-2xl">
        <DialogTitle>Scan a document</DialogTitle>
        {leaving ? (
          <>
            <DialogDescription>
              Discard this scan?{' '}
              {pages.length
                ? `${pages.length} ${pages.length === 1 ? 'page has' : 'pages have'} not been saved.`
                : 'The photo has not been kept.'}
            </DialogDescription>
            <div className="scan-actions">
              <Button onClick={() => setLeaving(false)}>Keep scanning</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Discard scan
              </Button>
            </div>
          </>
        ) : draft ? (
          <>
            <DialogDescription>
              {draft.found
                ? 'The page was found. Drag a corner if the outline is off.'
                : 'The page edges did not stand out. Drag the corners to the corners of the page.'}
            </DialogDescription>
            <div className="scan-stage-wrap">
              <div className="scan-stage" ref={stage}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.url}
                  alt="What the camera captured"
                  draggable={false}
                />
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polygon
                    points={quad
                      .map((p) => `${p.x * 100},${p.y * 100}`)
                      .join(' ')}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {quad.map((point, index) => (
                  <button
                    key={corners[index]}
                    type="button"
                    className="scan-corner"
                    aria-label={`${corners[index]} corner. Drag, or use the arrow keys.`}
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`,
                    }}
                    disabled={!!working}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag(index, event);
                    }}
                    onPointerMove={(event) => {
                      if (
                        event.currentTarget.hasPointerCapture(event.pointerId)
                      )
                        drag(index, event);
                    }}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 0.05 : 0.01;
                      const by: Record<string, [number, number]> = {
                        ArrowLeft: [-step, 0],
                        ArrowRight: [step, 0],
                        ArrowUp: [0, -step],
                        ArrowDown: [0, step],
                      };
                      const delta = by[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      move(index, point.x + delta[0], point.y + delta[1]);
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="scan-finish">
              <canvas
                ref={preview}
                className="scan-preview"
                aria-hidden="true"
              />
              <fieldset className="scan-filters" disabled={!!working}>
                <legend>Look</legend>
                {filters.map((option) => (
                  <label key={option.value}>
                    <input
                      type="radio"
                      name="scan-filter"
                      checked={filter === option.value}
                      onChange={() => setFilter(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="scan-actions">
              <Button disabled={!!working} onClick={() => void keep()}>
                Keep this page
              </Button>
              <Button
                variant="outline"
                disabled={!!working}
                onClick={() => setQuad(wholePhoto(0))}
              >
                Use whole photo
              </Button>
              <Button
                variant="outline"
                disabled={!!working}
                onClick={() => {
                  release(draft.url);
                  setDraft(null);
                  setError('');
                }}
              >
                Discard photo
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogDescription>
              {pages.length
                ? 'Add another page, or save these as one PDF in Documents.'
                : 'Lay the paper on a darker surface with all four corners in view, then take a photo.'}
            </DialogDescription>
            {!!pages.length && (
              <ol className="scan-pages" aria-label="Scanned pages">
                {pages.map((page, index) => (
                  <li key={page.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={page.url} alt={`Page ${index + 1}`} />
                    <span>Page {index + 1}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={!!working}
                      aria-label={`Remove page ${index + 1}`}
                      onClick={() => {
                        release(page.url);
                        setPages((current) =>
                          current.filter((item) => item.id !== page.id),
                        );
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {full ? (
              <p className="subtle">
                A scan holds up to {SCAN_PAGE_LIMIT} pages. Save this one, then
                start another.
              </p>
            ) : (
              <div className="scan-actions">
                {photoInput(pages.length ? 'Add a page' : 'Take a photo', true)}
                {photoInput('Choose a photo', false)}
              </div>
            )}
            {!!pages.length && (
              <form
                className="content-link-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label htmlFor="scan-name">Name</label>
                <Input
                  id="scan-name"
                  value={name}
                  maxLength={100}
                  placeholder={`Scan ${today}`}
                  disabled={!!working}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button type="submit" disabled={!!working}>
                  Save {pages.length === 1 ? '1 page' : `${pages.length} pages`}{' '}
                  as PDF
                </Button>
              </form>
            )}
          </>
        )}
        {error && !leaving && (
          <p role="alert" className="content-error">
            {error}
          </p>
        )}
        <output className={`content-status${working ? ' is-busy' : ''}`}>
          {working && (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
              {working}
            </>
          )}
        </output>
      </DialogContent>
    </Dialog>
  );
}
