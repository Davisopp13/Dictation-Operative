'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Clipboard,
  Pin,
  Search,
  X,
  Download,
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
import type { ClipSummary } from '@/lib/domain';

export type LibraryProps = {
  dailyCleanup: boolean;
  clipboardFilter: 'all' | 'pinned' | 'images';
  setClipboardFilter: (filter: 'all' | 'pinned' | 'images') => void;
  accountEmail: string;
  onClipboardSaved: () => void;
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
  setImportOpen: (open: boolean) => void;
  exportLibrary: () => Promise<void>;
  locked: boolean;
};

/** Saved Clipboard text and images. */
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
  setImportOpen,
  exportLibrary,
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
                    ? 'No pinned items yet'
                    : 'Your saved items will appear here'}
              </EmptyTitle>
              <EmptyDescription>
                {filtered
                  ? 'Try another search or clear your filters.'
                  : pinned
                    ? 'Pin text or images from All to keep them handy and protect them from daily cleanup.'
                    : 'Paste text or upload an image above to get started.'}
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
  return (
    <>
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
      <div className="library-toolbar">
        <div className="search-field">
          <Search size={18} />
          <Input
            className="search-input"
            aria-label="Search Clipboard"
            placeholder="Search words and image names…"
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
        {clipboardFilter !== 'images' && (
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
            </div>
          </SheetContent>
        </Sheet>
        <Button
          variant="outline"
          className="control library-desktop-action"
          disabled={locked}
          onClick={() => setImportOpen(true)}
        >
          Import text
        </Button>
        <Button
          className="control library-desktop-action"
          variant="outline"
          disabled={locked}
          onClick={() => void exportLibrary()}
        >
          <Download /> Export text
        </Button>
      </div>
          <div className="clipboard-sync-bar">
            <div className="clipboard-sync-summary">
              <strong>Shared Clipboard</strong>
              <span>{accountEmail} · Refreshes every 5 seconds</span>
            </div>
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
          <p className="subtle text-sm">
            {dailyCleanup
              ? 'Daily cleanup is on. Unpinned Clipboard text and images older than 24 hours are cleared once a day. Pin anything you want to keep. Earlier dictation history and text saved before cleanup existed stay saved.'
              : 'Daily cleanup is off. Your saved items stay until you delete them. Pin text or images to keep them handy.'}
          </p>
          <div hidden={clipboardFilter === 'images'}>
            <ClipboardText locked={locked} onSaved={onClipboardSaved} />
          </div>
          {clipboardFilter === 'all' && (collectionFilter || tagFilter) && (
            <p className="subtle text-sm">
              Showing text matching your collection or tag. Clear these filters
              to include images.
            </p>
          )}
      {clipboardFilter === 'images' ? (
        <ClipboardImages query={query} locked={locked} />
      ) : !collectionFilter && !tagFilter ? (
        <ClipboardImages
          query={query}
          locked={locked}
          renderFeed={renderFeed}
          pinnedOnly={clipboardFilter === 'pinned'}
        />
      ) : (
        renderFeed()
      )}
    </>
  );
}
