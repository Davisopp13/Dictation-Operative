'use client';
import type { Dispatch, SetStateAction } from 'react';
import { Layers, ChevronUp, ChevronDown, X, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ClipSummary } from '@/lib/domain';

export const formatNames = {
  join: 'Keep my words',
  update: 'Progress update',
  email: 'Email',
  checklist: 'Checklist',
};

export type ComposeFormat = keyof typeof formatNames;

export type ComposeProps = {
  selected: ClipSummary[];
  setSelected: Dispatch<SetStateAction<ClipSummary[]>>;
  format: ComposeFormat;
  setFormat: (format: ComposeFormat) => void;
  compose: () => Promise<void>;
  resetComposeId: () => void;
  toggleSelection: (clip: ClipSummary) => void;
  busy: boolean;
  locked: boolean;
};

/** Compose: order a few thoughts and decide what to make of them. */
export function ComposeSurface({
  selected,
  setSelected,
  format,
  setFormat,
  compose,
  resetComposeId,
  toggleSelection,
  busy,
  locked,
}: ComposeProps) {
  return (
            <section className="panel compose-panel">
              <div className="section-line">
                <h2>
                  Your ingredients{' '}
                  <span className="subtle font-normal">
                    {selected.length}/20
                  </span>
                </h2>
                {selected.length > 0 && (
                  <Button
                    variant="ghost"
                    className="control"
                    disabled={locked}
                    onClick={() => {
                      setSelected([]);
                      resetComposeId();
                    }}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              {selected.length ? (
                <ol className="selected-list">
                  {selected.map((item, i) => (
                    <li key={item.id}>
                      <span className="order-number">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate">
                        {item.title}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="icon-control"
                        aria-label={`Move ${item.title} up`}
                        disabled={i === 0 || locked}
                        onClick={() => {
                          setSelected((current) => {
                            const next = [...current];
                            [next[i - 1], next[i]] = [next[i], next[i - 1]];
                            return next;
                          });
                          resetComposeId();
                        }}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="icon-control"
                        aria-label={`Move ${item.title} down`}
                        disabled={i === selected.length - 1 || locked}
                        onClick={() => {
                          setSelected((current) => {
                            const next = [...current];
                            [next[i], next[i + 1]] = [next[i + 1], next[i]];
                            return next;
                          });
                          resetComposeId();
                        }}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="icon-control"
                        aria-label={`Remove ${item.title}`}
                        disabled={locked}
                        onClick={() => toggleSelection(item)}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="subtle text-sm">
                  Select at least two thoughts below. Their original
                  versions stay in your library.
                </p>
              )}
              <span className="field-label mt-5">Turn them into</span>
              <Tabs
                value={format}
                onValueChange={(value) => {
                  setFormat(value as keyof typeof formatNames);
                  resetComposeId();
                }}
              >
                <TabsList className="format-tabs">
                  {Object.entries(formatNames).map(([key, label]) => (
                    <TabsTrigger disabled={locked} key={key} value={key}>
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="actions">
                <Button
                  className="control"
                  disabled={selected.length < 2 || locked}
                  onClick={() => void compose()}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Layers />
                  )}{' '}
                  Create draft
                </Button>
                <p className="subtle text-sm">
                  {format === 'join'
                    ? 'Join in your chosen order. No AI required.'
                    : 'A new draft, ready for your review.'}
                </p>
              </div>
            </section>
  );
}
