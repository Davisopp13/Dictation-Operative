'use client';
import { useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Library,
  Pin,
  Search,
  X,
  Download,
  Layers,
  LoaderCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { ClipboardImages } from './clipboard-images';
import { ClipboardText } from './clipboard-text';
import { ClipboardSyncControls } from './clipboard-sync';
import { ComposeSurface, type ComposeFormat } from './compose';
import type { ClipSummary } from '@/lib/domain';

type View = 'capture' | 'library' | 'clipboard' | 'compose';

export type LibraryProps = {
  accountEmail: string;
  onClipboardSaved: () => void;
  view: View;
  setView: (view: View) => void;
  collectionFilter: string;
  setCollectionFilter: (value: string) => void;
  tagFilter: string;
  setTagFilter: (value: string) => void;
  organization: { collections: string[]; tags: string[] };
  query: string;
  setQuery: (value: string) => void;
  clips: ClipSummary[];
  card: (item: ClipSummary, selectable?: boolean) => ReactNode;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  selected: ClipSummary[];
  setSelected: Dispatch<SetStateAction<ClipSummary[]>>;
  toggleSelection: (clip: ClipSummary) => void;
  format: ComposeFormat;
  setFormat: (format: ComposeFormat) => void;
  compose: () => Promise<void>;
  resetComposeId: () => void;
  setImportOpen: (open: boolean) => void;
  exportLibrary: () => Promise<void>;
  busy: boolean;
  locked: boolean;
};

/** Shared text list for Library, Clipboard, and Compose. */
export function LibrarySurface({
  view,
  setView,
  collectionFilter,
  setCollectionFilter,
  tagFilter,
  setTagFilter,
  organization,
  query,
  setQuery,
  clips,
  card,
  loading,
  hasMore,
  loadMore,
  selected,
  setSelected,
  toggleSelection,
  format,
  setFormat,
  compose,
  resetComposeId,
  setImportOpen,
  exportLibrary,
  busy,
  locked,
  accountEmail,
  onClipboardSaved,
}: LibraryProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const filters = (
    <div className="library-filter-fields">
      <label className="field-label">
        Collection
        <NativeSelect
          className="field"
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
        >
          <option value="">All collections</option>
          {organization.collections.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </NativeSelect>
      </label>
      <label className="field-label">
        Tag
        <NativeSelect
          className="field"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
        >
          <option value="">All tags</option>
          {organization.tags.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </NativeSelect>
      </label>
    </div>
  );
  return (
    <>
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={18} />
          <Input
            className="search-input"
            aria-label={
              view === 'clipboard' ? 'Search Clipboard' : 'Search thoughts'
            }
            placeholder={
              view === 'clipboard'
                ? 'Search words and image names…'
                : 'Search your words…'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="library-desktop-filters">{filters}</div>
        <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
          <SheetTrigger
            render={
              <Button
                variant="outline"
                className="control mobile-library-options"
                aria-label="Filters and library options"
              />
            }
          >
            <SlidersHorizontal />
            <span>Filter{collectionFilter || tagFilter ? ' · On' : ''}</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="mobile-menu-sheet">
            <SheetHeader>
              <SheetTitle>Filters and options</SheetTitle>
              <SheetDescription>
                {view === 'clipboard'
                  ? 'Filter pinned text by collection or tag.'
                  : 'Narrow down your thoughts.'}
              </SheetDescription>
            </SheetHeader>
            <div className="mobile-library-fields">
              {filters}
              {(collectionFilter || tagFilter) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCollectionFilter('');
                    setTagFilter('');
                  }}
                >
                  Clear filters
                </Button>
              )}
              <Button
                className="control w-full"
                onClick={() => setOptionsOpen(false)}
              >
                Show results
              </Button>
              {view !== 'compose' && (
                <div className="actions">
                  <Button
                    variant="outline"
                    className="control"
                    disabled={locked}
                    onClick={() => {
                      setOptionsOpen(false);
                      setImportOpen(true);
                    }}
                  >
                    Import text
                  </Button>
                  <Button
                    variant="outline"
                    className="control"
                    disabled={locked}
                    onClick={() => {
                      setOptionsOpen(false);
                      void exportLibrary();
                    }}
                  >
                    <Download /> Export text
                  </Button>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
        {view !== 'compose' && (
          <Button
            variant="outline"
            className="control library-desktop-action"
            disabled={locked}
            onClick={() => setImportOpen(true)}
          >
            Import text
          </Button>
        )}
        {view !== 'compose' && (
          <Button
            className="control library-desktop-action"
            variant="outline"
            disabled={locked}
            onClick={() => void exportLibrary()}
          >
            <Download /> Export text
          </Button>
        )}
      </div>
      {view === 'clipboard' && (
        <>
          <p className="subtle text-sm">
            Shared Clipboard · {accountEmail} · Refreshes every 5 seconds
          </p>
          <ClipboardSyncControls />
          <ClipboardText locked={locked} onSaved={onClipboardSaved} />
          <ClipboardImages query={query} locked={locked} />
        </>
      )}
      {view === 'compose' && (
        <ComposeSurface
          selected={selected}
          setSelected={setSelected}
          format={format}
          setFormat={setFormat}
          compose={compose}
          resetComposeId={() => {
            resetComposeId();
          }}
          toggleSelection={toggleSelection}
          busy={busy}
          locked={locked}
        />
      )}
      {view !== 'compose' && selected.length > 0 && (
        <div className="selection-bar">
          <span>{selected.length} selected</span>
          <Button
            className="control"
            disabled={locked}
            onClick={() => setView('compose')}
          >
            <Layers /> Compose with these
          </Button>
          <Button
            variant="ghost"
            className="control"
            onClick={() => setSelected([])}
          >
            Clear
          </Button>
        </div>
      )}
      {view === 'clipboard' && clips.length > 0 && (
        <h2 className="mb-4 text-lg font-semibold">Pinned text</h2>
      )}
      {loading ? (
        <output className="loading-state">
          <LoaderCircle className="animate-spin" />{' '}
          {view === 'clipboard'
            ? 'Loading pinned text…'
            : 'Opening your library…'}
        </output>
      ) : clips.length ? (
        <div className="thought-list">
          {clips.map((item) => card(item, true))}
        </div>
      ) : (
        <Empty className="panel empty-library">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="empty-icon">
              {view === 'clipboard' ? <Pin /> : <Library />}
            </EmptyMedia>
            <EmptyTitle>
              {query
                ? 'No thoughts match that search'
                : view === 'clipboard'
                  ? 'Pinned text'
                  : 'Your library starts with a thought'}
            </EmptyTitle>
            <EmptyDescription>
              {query
                ? 'Try another word or search your full history.'
                : view === 'clipboard'
                  ? 'Pin a thought from Library to keep reusable words here.'
                  : 'Speak or paste your first thought. It will be waiting here.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              className="control"
              onClick={() => {
                if (query) setQuery('');
                else if (view === 'clipboard') setView('library');
                else setView('capture');
              }}
            >
              {query
                ? 'Clear search'
                : view === 'clipboard'
                  ? 'Browse Library'
                  : 'Capture a thought'}
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {hasMore && !loading && (
        <Button
          variant="outline"
          className="control mt-5 w-full"
          disabled={locked}
          onClick={() => void loadMore()}
        >
          Load more thoughts
        </Button>
      )}
    </>
  );
}
