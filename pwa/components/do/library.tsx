'use client';
import { useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Clipboard,
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
import { mergeClipboardFeed } from '@/lib/clipboard-feed';
import { ClipboardImages, type ImageFeed } from './clipboard-images';
import { ClipboardText } from './clipboard-text';
import { ClipboardSyncControls } from './clipboard-sync';
import { ComposeSurface, type ComposeFormat } from './compose';
import type { ClipSummary } from '@/lib/domain';

type View = 'capture' | 'clipboard' | 'compose';

export type LibraryProps = {
  clipboardFilter: 'all' | 'pinned' | 'images';
  setClipboardFilter: (filter: 'all' | 'pinned' | 'images') => void;
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

/** Saved Clipboard items and text selection for Compose. */
export function LibrarySurface({
  view,
  setView,
  clipboardFilter,
  setClipboardFilter,
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
  const renderFeed = (imageFeed?: ImageFeed) => {
    const items = mergeClipboardFeed(
      clips.map((item) => ({
        id: `text:${item.id}`,
        time: item.updatedAt,
        content: card(item, true),
      })),
      imageFeed?.items ?? [],
      hasMore,
      imageFeed?.hasMore ?? false,
    );
    const pending = loading || imageFeed?.loading;
    const filtered = !!(query || collectionFilter || tagFilter);
    const pinned = view === 'clipboard' && clipboardFilter === 'pinned';
    return (
      <>
        {pending ? (
          <output className="loading-state">
            <LoaderCircle className="animate-spin" /> Loading saved items…
          </output>
        ) : items.length ? (
          <div className="thought-list clipboard-feed">
            {items.map((item) => (
              <div key={item.id}>{item.content}</div>
            ))}
          </div>
        ) : (
          <Empty className="panel empty-library">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="empty-icon">
                {pinned ? <Pin /> : <Clipboard />}
              </EmptyMedia>
              <EmptyTitle>
                {filtered
                  ? 'No items match these filters'
                  : pinned
                    ? 'No pinned text yet'
                    : 'Your saved items will appear here'}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? 'Try another search or clear your filters.'
                  : pinned
                    ? 'Pin text from All to keep it handy. Unpinning keeps it in All.'
                    : 'Capture a thought, paste text, or upload an image to get started.'}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                className="control"
                onClick={() => {
                  if (filtered) {
                    setQuery('');
                    setCollectionFilter('');
                    setTagFilter('');
                  } else if (pinned) setClipboardFilter('all');
                  else setView('capture');
                }}
              >
                {filtered
                  ? 'Clear filters'
                  : pinned
                    ? 'Browse All'
                    : 'Capture a thought'}
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {(hasMore || imageFeed?.hasMore) && !pending && (
          <Button
            variant="outline"
            className="control mt-5 w-full"
            disabled={locked || imageFeed?.busy}
            onClick={() => {
              if (hasMore) void loadMore();
              if (imageFeed?.hasMore) void imageFeed.loadMore();
            }}
          >
            Load more items
          </Button>
        )}
      </>
    );
  };
  return (
    <>
      {view === 'clipboard' && (
        <fieldset
          className="clipboard-filters actions"
          aria-label="Clipboard filter"
        >
          {(['all', 'pinned', 'images'] as const).map((filter) => (
            <Button
              key={filter}
              className="control"
              variant={clipboardFilter === filter ? 'secondary' : 'ghost'}
              aria-pressed={clipboardFilter === filter}
              disabled={locked}
              onClick={() => setClipboardFilter(filter)}
            >
              {filter === 'all'
                ? 'All'
                : filter === 'pinned'
                  ? 'Pinned'
                  : 'Images'}
            </Button>
          ))}
        </fieldset>
      )}
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
        {(view !== 'clipboard' || clipboardFilter !== 'images') && (
          <div className="library-desktop-filters">{filters}</div>
        )}
        <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
          <SheetTrigger
            render={
              <Button
                variant="outline"
                className="control mobile-library-options"
                aria-label="Filters and Clipboard options"
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
                  ? 'Filter saved text by collection or tag. Images have no collection or tags.'
                  : 'Narrow down your thoughts.'}
              </SheetDescription>
            </SheetHeader>
            <div className="mobile-library-fields">
              {(view !== 'clipboard' || clipboardFilter !== 'images') &&
                filters}
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
          <div className="clipboard-sync-bar">
            <div className="clipboard-sync-summary">
              <strong>Shared Clipboard</strong>
              <span>{accountEmail} · Refreshes every 5 seconds</span>
            </div>
            <ClipboardSyncControls
              sources={
                clipboardFilter === 'images'
                  ? ['images']
                  : clipboardFilter === 'pinned' ||
                      collectionFilter ||
                      tagFilter
                    ? ['text']
                    : ['text', 'images']
              }
            />
          </div>
          <div hidden={clipboardFilter === 'images'}>
            <ClipboardText locked={locked} onSaved={onClipboardSaved} />
          </div>
          {clipboardFilter === 'all' && (collectionFilter || tagFilter) && (
            <p className="subtle text-sm">
              Showing text matching your collection or tag. Clear these filters
              to include images.
            </p>
          )}
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
      {view === 'clipboard' && clipboardFilter === 'images' ? (
        <ClipboardImages query={query} locked={locked} />
      ) : view === 'clipboard' &&
        clipboardFilter === 'all' &&
        !collectionFilter &&
        !tagFilter ? (
        <ClipboardImages
          query={query}
          locked={locked}
          renderFeed={renderFeed}
        />
      ) : (
        renderFeed()
      )}
    </>
  );
}
