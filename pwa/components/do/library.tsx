'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Clipboard,
  Pin,
  Search,
  X,
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
import { ScreenTitle } from './screen-title';
import type { ClipSummary } from '@/lib/domain';

export type LibraryProps = {
  dailyCleanup: boolean;
  clipboardFilter: 'all' | 'pinned' | 'images';
  setClipboardFilter: (filter: 'all' | 'pinned' | 'images') => void;
  onClipboardSaved: (id: string) => void;
  collectionFilter: string;
  setCollectionFilter: (value: string) => void;
  tagFilter: string;
  setTagFilter: (value: string) => void;
  organization: { collections: string[]; tags: string[] };
  query: string;
  setQuery: (value: string) => void;
  clips: ClipSummary[];
  card: (item: ClipSummary) => ReactNode;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  locked: boolean;
  /** Phones show the add panel as its own full screen while this is true. */
  addOpen: boolean;
  onAddClose: () => void;
};

/**
 * The Clipboard screen: a blue "Catch something" panel for bringing things
 * in, beside the saved text and images.
 */
export function LibrarySurface({
  dailyCleanup,
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
  locked,
  onClipboardSaved,
  addOpen,
  onAddClose,
}: LibraryProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The image controls belong to ClipboardImages but are drawn inside the add
  // panel; it renders them into this element.
  const [imageSlot, setImageSlot] = useState<HTMLElement | null>(null);
  const filters = (
    <>
      <label className="filter-select">
        <span className="sr-only">Collection</span>
        <NativeSelect
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
        >
          <option value="">All collections</option>
          {organization.collections.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </NativeSelect>
      </label>
      {organization.tags.length > 0 && (
        <label className="filter-select">
          <span className="sr-only">Tag</span>
          <NativeSelect
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">All tags</option>
            {organization.tags.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </NativeSelect>
        </label>
      )}
    </>
  );
  const renderFeed = (imageFeed?: ImageFeed) => {
    const items = mergeClipboardFeed(
      clips.map((item) => ({
        id: `text:${item.id}`,
        time: item.updatedAt,
        content: card(item),
      })),
      imageFeed?.items ?? [],
      hasMore,
      imageFeed?.hasMore ?? false,
    );
    const pending = loading || imageFeed?.loading;
    const filtered = !!(query || collectionFilter || tagFilter);
    const pinned = clipboardFilter === 'pinned';
    return (
      <>
        {pending ? (
          <output className="loading-state">
            <LoaderCircle className="animate-spin" /> Loading saved items…
          </output>
        ) : items.length ? (
          <div className="card-grid">
            {items.map((item) => (
              <div key={item.id}>{item.content}</div>
            ))}
          </div>
        ) : (
          <Empty className="desk-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="empty-icon">
                {pinned ? <Pin /> : <Clipboard />}
              </EmptyMedia>
              <EmptyTitle>
                {filtered
                  ? 'No items match these filters'
                  : pinned
                    ? 'No pinned items yet'
                    : 'Your saved items will appear here'}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? 'Try another search or clear your filters.'
                  : pinned
                    ? 'Pin text or images from All to keep them handy and protect them from daily cleanup.'
                    : 'Paste text or add an image to get started.'}
              </EmptyDescription>
            </EmptyHeader>
            {(filtered || pinned) && (
              <EmptyContent>
                <Button
                  variant="outline"
                  className="control"
                  onClick={() => {
                    if (filtered) {
                      setQuery('');
                      setCollectionFilter('');
                      setTagFilter('');
                    } else setClipboardFilter('all');
                  }}
                >
                  {filtered ? 'Clear filters' : 'Browse All'}
                </Button>
              </EmptyContent>
            )}
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
  const segments = (
    <fieldset className="segmented" aria-label="Show">
      {(['all', 'pinned', 'images'] as const).map((filter) => (
        <button
          key={filter}
          type="button"
          aria-pressed={clipboardFilter === filter}
          disabled={locked}
          onClick={() => setClipboardFilter(filter)}
        >
          {filter === 'all' ? 'All' : filter === 'pinned' ? 'Pinned' : 'Images'}
        </button>
      ))}
    </fieldset>
  );
  return (
    <>
      <ScreenTitle
        title="Clipboard"
        subtitle="Paste it here. Pick it up on any device."
        accent="mint"
        aside={segments}
      />
      <div className="clipboard-layout">
        <section
          className={`catch-panel${addOpen ? ' is-open' : ''}`}
          aria-label="Add to Clipboard"
        >
          <div className="catch-panel-mobile-head">
            <button type="button" onClick={onAddClose}>
              Cancel
            </button>
          </div>
          <div className="catch-panel-title">
            <h2>Catch something</h2>
            <span aria-hidden="true" />
            <p>It will be waiting on your other devices.</p>
          </div>
          <ClipboardText locked={locked} onSaved={onClipboardSaved} />
          <div ref={setImageSlot} className="catch-images" />
          <div className="catch-sync">
            <ClipboardSyncControls
              sources={
                clipboardFilter === 'images'
                  ? ['images']
                  : collectionFilter || tagFilter
                    ? ['text']
                    : ['text', 'images']
              }
            />
          </div>
        </section>

        <section className="saved-items" aria-label="Saved items">
          <div className="saved-toolbar">
            <div className="search-box">
              <Search size={20} aria-hidden="true" />
              <Input
                aria-label="Search Clipboard"
                placeholder="Search words and image names"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={200}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {clipboardFilter !== 'images' && (
              <div className="saved-filters">{filters}</div>
            )}
            <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
              <SheetTrigger
                render={
                  <button
                    type="button"
                    className="icon-button saved-filter-button"
                    aria-label={`Filters${collectionFilter || tagFilter ? ', on' : ''}`}
                  />
                }
              >
                <SlidersHorizontal aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="bottom" className="mobile-menu-sheet">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                  <SheetDescription>
                    Filter saved text by collection or tag. Images have no
                    collection or tags.
                  </SheetDescription>
                </SheetHeader>
                <div className="mobile-library-fields">
                  {clipboardFilter !== 'images' && filters}
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
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <p className="saved-note">
            {dailyCleanup
              ? 'Daily cleanup is on: eligible text and images older than 24 hours clear once a day. Pins, pile memberships and pending collection holds protect items.'
              : 'Saved items stay until you delete them.'}
            {clipboardFilter === 'all' && (collectionFilter || tagFilter)
              ? ' Showing text matching your collection or tag; clear these filters to include images.'
              : ''}
          </p>
          {clipboardFilter === 'images' ? (
            <ClipboardImages
              query={query}
              locked={locked}
              addSlot={imageSlot}
            />
          ) : !collectionFilter && !tagFilter ? (
            <ClipboardImages
              query={query}
              locked={locked}
              renderFeed={renderFeed}
              pinnedOnly={clipboardFilter === 'pinned'}
              addSlot={imageSlot}
            />
          ) : (
            renderFeed()
          )}
        </section>
      </div>
    </>
  );
}
