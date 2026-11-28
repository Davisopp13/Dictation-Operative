'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, post, errorMessage, APIError } from '@/lib/client';
import {
  Intent,
  MembershipBatch,
  isConflict,
  itemPath,
  keyOf,
  sourcePath,
  selectionRange,
  type Pile,
  type PilePage,
  type ItemsPage,
  type PileItems,
  type MemberImpact,
  type MemberOutcome,
  type BackfillStatus,
} from '@/lib/desk-client';
import type { SharedItem, ItemReference } from '@/lib/shared-items';
import type { Clip } from '@/lib/domain';
import {
  contentLink,
  contentProvider,
  declaredContentType,
  CONTENT_FILE_LIMIT,
  type ContentItem,
} from '@/lib/content-model';
import { imagePayload, writeClipboard } from '@/lib/sync/clipboard';
import { ClipboardText } from './clipboard-text';
import { DocumentScanner } from './document-scanner';
import { PdfPreview } from './pdf-preview';
import { DocumentPrintButton } from './document-print';
import { ScreenTitle } from './screen-title';

const colors = ['blue', 'glow', 'sky', 'mint', 'sunny', 'paper'];
type DeskContext = {
  epoch: number;
  refresh: () => void;
  membership: (refs: ItemReference[]) => void;
  progress: () => void;
  catchInto: (pile?: Pile) => void;
  details: (item: SharedItem) => void;
  removed: (undo: Undo) => void;
};
const Context = createContext<DeskContext | null>(null);
export const useDesk = () => useContext(Context)!;
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="text-destructive break-words">
      {error}
    </p>
  ) : null;
}
function Modal({
  title,
  description,
  children,
  onClose,
  returnFocus,
}: {
  title: string;
  description: string;
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
  onClose: () => void;
}) {
  const [invoker] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const returnFocusRef = useRef(returnFocus);
  useEffect(() => {
    returnFocusRef.current = returnFocus;
  }, [returnFocus]);
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const explicit = returnFocusRef.current?.();
        const target =
          explicit ??
          (invoker?.isConnected
            ? invoker
            : (document.querySelector<HTMLElement>(
                '[data-slot=dialog-content] button:not(:disabled)',
              ) ?? document.getElementById('desk-main')));
        target?.focus();
      });
    },
    [invoker],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="p3-modal sm:max-w-xl"
        finalFocus={() =>
          returnFocusRef.current?.() ??
          (invoker?.isConnected
            ? invoker
            : (document.querySelector<HTMLElement>(
                '[data-slot=dialog-content] button:not(:disabled)',
              ) ?? document.getElementById('desk-main')))
        }
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Protection({ item }: { item: SharedItem }) {
  const { progress } = useDesk();
  return (
    <div className="p3-protection">
      {item.piles.map((p) => (
        <span className={`p3-chip p3-${p.color}`} key={p.id}>
          {p.name}
        </span>
      ))}
      {item.organization?.pending && (
        <button className="text-link" onClick={progress}>
          ⓘ Collection pending
        </button>
      )}
      {item.organization?.state === 'suppressed_settled' && (
        <span>Automatic collection linking disabled</span>
      )}
      <small>
        {item.cleanup.eligible && item.cleanup.clearsAt
          ? `Clears ${new Date(item.cleanup.clearsAt).toLocaleString()}`
          : item.cleanup.reason === 'collection_pending'
            ? 'Held from daily cleanup while collection is pending.'
            : item.cleanup.reason
              ? `Kept: ${item.cleanup.reason.replaceAll('_', ' ')}`
              : 'Daily cleanup is off.'}
      </small>
    </div>
  );
}
/** Existing store cards participate without taking over their filters/editor. */
export function ItemOrganization({
  refValue,
  revision,
}: {
  refValue: ItemReference;
  revision?: number;
}) {
  const desk = useDesk(),
    [item, setItem] = useState<SharedItem | null>(null),
    [error, setError] = useState(false);
  const { kind, id } = refValue;
  useEffect(() => {
    const c = new AbortController();
    api<SharedItem>(itemPath({ kind, id }), { signal: c.signal })
      .then((value) => {
        setItem(value);
        setError(false);
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setItem(null);
          setError(true);
        }
      });
    return () => c.abort();
  }, [kind, id, revision, desk.epoch]);
  return (
    <div className="p3-organization">
      {item && <Protection item={item} />}{' '}
      {error && <small>Organization status unavailable.</small>}
      {item?.contentKind === 'link' && (
        <Button variant="outline" onClick={() => desk.details(item)}>
          Edit link / details
        </Button>
      )}
      <Button variant="outline" onClick={() => desk.membership([{ kind, id }])}>
        Add to pile / memberships
      </Button>
    </div>
  );
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0),
    [refs, setRefs] = useState<ItemReference[] | null>(null),
    [progress, setProgress] = useState(false);
  const [catchTarget, setCatchTarget] = useState<{
    pile?: Pile;
    initialText?: string;
  } | null>(null);
  const [undos, setUndos] = useState<Undo[]>([]);
  const [details, setDetails] = useState<SharedItem | null>(null);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        catchTarget ||
        target?.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      const text = event.clipboardData?.getData('text/plain');
      if (text && text.length <= 20000) {
        event.preventDefault();
        setCatchTarget({ initialText: text });
      }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [catchTarget]);
  const refresh = useCallback(() => setEpoch((n) => n + 1), []);
  return (
    <Context.Provider
      value={{
        epoch,
        refresh,
        membership: setRefs,
        progress: () => setProgress(true),
        catchInto: (pile) => setCatchTarget({ pile }),
        details: setDetails,
        removed: (undo) => setUndos((current) => [...current, undo]),
      }}
    >
      {children}
      <section className="p3-undo-stack" aria-label="Removal notifications">
        {undos.map((undo) => (
          <UndoNotice
            key={undo.operationId}
            undo={undo}
            onDone={() =>
              setUndos((current) =>
                current.filter((u) => u.operationId !== undo.operationId),
              )
            }
          />
        ))}
      </section>
      {refs && <MembershipDialog refs={refs} onClose={() => setRefs(null)} />}
      {details && (
        <ItemPreview item={details} onClose={() => setDetails(null)} />
      )}
      {progress && <BackfillDialog onClose={() => setProgress(false)} />}
      {catchTarget && (
        <CatchPanel
          pile={catchTarget.pile}
          initialText={catchTarget.initialText}
          onClose={() => setCatchTarget(null)}
        />
      )}
    </Context.Provider>
  );
}

function BackfillDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useDesk(),
    [status, setStatus] = useState<BackfillStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    alive = useRef(true);
  const read = useCallback(async () => {
    const next = await api<BackfillStatus>('v1/collection-backfill');
    if (alive.current) setStatus(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    void read().catch((e) => setError(errorMessage(e)));
    return () => {
      alive.current = false;
    };
  }, [read]);
  async function advance() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await post('v1/collection-backfill', { limit: 25 });
      await read();
      refresh();
    } catch (e) {
      if (alive.current) {
        setError(
          `Progress may have committed. Refresh status or Continue to process remaining work. ${errorMessage(e)}`,
        );
        await read().catch(() => {});
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="Collection progress"
      description="Reconcile existing collection organization. This does not copy your sources."
      onClose={onClose}
    >
      <p>
        Pending sources are excluded from daily cleanup. They are not committed
        members of their collection’s pile. A hold can last indefinitely.
      </p>
      {status ? (
        <dl className="p3-counts">
          <dt>Pending</dt>
          <dd>{status.pending}</dd>
          <dt>Ready to continue</dt>
          <dd>{status.ready}</dd>
          <dt>Pile limit</dt>
          <dd>{status.pileCapacity}</dd>
          <dt>Member-slot limit</dt>
          <dd>{status.memberCapacity}</dd>
          <dt>Suppressed pending</dt>
          <dd>{status.suppressedPending}</dd>
          <dt>Mapped collections</dt>
          <dd>{status.mappedKeys}</dd>
        </dl>
      ) : (
        <p>Loading status…</p>
      )}
      {status && (
        <output>
          {status.complete
            ? 'Complete in this snapshot. Later changes can create pending work.'
            : status.ready
              ? 'Work is ready. Each Continue processes at most 25 sources.'
              : 'Blocked. Repeating Continue cannot resolve these limits.'}
        </output>
      )}
      <p>
        The 100-pile limit includes empty mapped piles. The 500-slot limit
        includes retained inactive slots: fewer visible members does not
        guarantee room. Clearing or moving a collection does not release its old
        slots. Adding to another pile does not resolve pending collection
        mapping.
      </p>
      <p>
        Suppressed keys never recreate their deleted pile on retry. You can
        deliberately change an individual Collection or add a manual membership.
        No automatic data deletion or slot release is offered.
      </p>
      <ErrorText error={error} />
      <div className="actions">
        <Button
          disabled={busy || !status?.ready}
          onClick={() => void advance()}
        >
          {busy ? 'Processing one batch…' : 'Continue (up to 25)'}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void read().catch((e) => setError(errorMessage(e)))}
        >
          Refresh status
        </Button>
      </div>
      <small>
        Closing stops further work. A batch already sent may commit; closing
        does not undo it.
      </small>
    </Modal>
  );
}

function PileForm({
  pile,
  refs = [],
  onDone,
  onClose,
}: {
  pile?: Pile;
  refs?: ItemReference[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [name, setName] = useState(pile?.name ?? ''),
    [color, setColor] = useState(pile?.color ?? 'blue'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [duplicates, setDuplicates] = useState<string[]>([]);
  const intent = useRef<Intent | null>(null),
    lock = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    api<PilePage>('v1/piles?limit=100', { signal: c.signal })
      .then((p) =>
        setDuplicates(
          p.piles.filter((p) => p.id !== pile?.id).map((p) => p.name),
        ),
      )
      .catch(() => {});
    return () => c.abort();
  }, [pile?.id]);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (refs.length > 50)
        throw new Error(
          'Choose at most 50 items for an atomic new pile. Nothing has been created.',
        );
      const data = pile
        ? { revision: pile.revision, name, color }
        : { name, color, members: refs };
      if (new TextEncoder().encode(JSON.stringify(data)).length > 11500)
        throw new Error(
          'This selection is too large for one atomic request. Choose fewer items.',
        );
      intent.current ??= new Intent(
        pile ? `v1/piles/${pile.id}` : 'v1/piles',
        pile ? 'PATCH' : 'POST',
        data,
      );
      setSent(true);
      await intent.current.send();
      onDone();
      onClose();
    } catch (e) {
      if (isConflict(e)) {
        intent.current = null;
        setSent(false);
        setError(`${errorMessage(e)} Close, refresh and reopen to reconfirm.`);
      } else setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={pile ? 'Edit pile' : 'New pile'}
      description={
        pile
          ? 'Rename or recolor this pile.'
          : 'Selected items are added atomically in selection order.'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <label htmlFor="pile-name">
        Name
        <Input
          id="pile-name"
          value={name}
          maxLength={120}
          disabled={busy || sent}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {duplicates.includes(name.trim()) && (
        <p>A pile already uses this name. Duplicate names are allowed.</p>
      )}
      <label>
        Color
        <select
          value={color}
          disabled={busy || sent}
          onChange={(e) => setColor(e.target.value)}
        >
          {colors.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <p>{refs.length} selected items</p>
      <ErrorText error={error} />
      <Button disabled={busy || !name.trim()} onClick={() => void save()}>
        {busy
          ? 'Saving…'
          : sent
            ? 'Retry same save'
            : pile
              ? 'Save pile'
              : 'Create pile'}
      </Button>
    </Modal>
  );
}

type Undo = {
  itemName: string;
  pileName: string;
  pileId: string;
  ref: ItemReference;
  operationId: string;
  revision: number;
};
function UndoNotice({ undo, onDone }: { undo: Undo; onDone: () => void }) {
  const { refresh } = useDesk(),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false),
    intent = useRef<Intent | null>(null);
  const finish = () => {
    onDone();
    requestAnimationFrame(() => document.getElementById('desk-main')?.focus());
  };
  return (
    <div className="p3-undo" aria-label="Removal result">
      <output>
        Removed {undo.itemName} from {undo.pileName}. Source and other
        memberships remain.
      </output>
      <Button
        disabled={busy || stale}
        onClick={() => {
          setBusy(true);
          intent.current ??= new Intent(
            `v1/piles/${undo.pileId}/members`,
            'POST',
            {
              ref: undo.ref,
              action: 'restore',
              revision: undo.revision,
              undoOperationId: undo.operationId,
            },
          );
          void intent.current
            .send()
            .then(() => {
              refresh();
              finish();
            })
            .catch((e) => {
              if (isConflict(e)) {
                setStale(true);
                refresh();
              }
              setError(
                `${errorMessage(e)} ${isConflict(e) ? 'Undo cannot overwrite newer changes. Refresh and review the item.' : ''}`,
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        Undo removal
      </Button>
      <Button variant="ghost" onClick={finish}>
        Dismiss
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
function MembershipDialog({
  refs,
  onClose,
}: {
  refs: ItemReference[];
  onClose: () => void;
}) {
  const alive = useRef(true),
    cancel = useRef(false),
    didRemove = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current = true;
    };
  }, []);
  const [batchPile, setBatchPile] = useState<Pile | null>(null);
  const [reconfirm, setReconfirm] = useState(false);
  const { refresh, removed } = useDesk(),
    [piles, setPiles] = useState<Pile[]>([]),
    [items, setItems] = useState<SharedItem[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [newPile, setNewPile] = useState(false),
    [result, setResult] = useState('');
  const [removal, setRemoval] = useState<{
    pile: Pile;
    item: SharedItem;
    impact: MemberImpact;
  } | null>(null);
  const pending = useRef<MembershipBatch | null>(null),
    lock = useRef(false);
  const read = useCallback(async () => {
    const list = await api<PilePage>('v1/piles?limit=100');
    const rows: SharedItem[] = [];
    for (let start = 0; start < refs.length; start += 8)
      rows.push(
        ...(await Promise.all(
          refs
            .slice(start, start + 8)
            .map((ref) => api<SharedItem>(itemPath(ref))),
        )),
      );
    const latest = await api<{ revision: number }>('v1/revision');
    if (
      latest.revision !== list.revision ||
      rows.some((row) => row.workspaceRevision !== list.revision)
    )
      throw new Error(
        'Workspace changed while reading memberships. Close and reopen to refresh.',
      );
    setPiles(list.piles);
    setItems(rows);
  }, [refs]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(read)
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [read]);
  async function add(pile: Pile) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    pending.current ??= new MembershipBatch(pile, refs);
    const batch = pending.current;
    batch.confirm();
    setBatchPile(batch.pile);
    setReconfirm(false);
    cancel.current = false;
    try {
      while (batch.remaining.length) {
        await batch.step(() => !alive.current || cancel.current);
        setResult(`${batch.done} of ${refs.length} additions confirmed.`);
      }
      pending.current = null;
      setBatchPile(null);
      refresh();
      await read();
    } catch (e) {
      setResult(
        `${batch.done} additions confirmed; ${batch.remaining.length} not confirmed.`,
      );
      setError(errorMessage(e));
      if (isConflict(e)) {
        setReconfirm(true);
        await read().catch(() => {});
        setError(
          `${errorMessage(e)} Review refreshed memberships and choose Add again to reconfirm remaining items.`,
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function previewRemove(pile: Pile, item: SharedItem) {
    setBusy(true);
    setError('');
    try {
      const impact = await api<MemberImpact>(
        `v1/piles/${pile.id}/members/${item.ref.kind}/${item.ref.id}/impact`,
      );
      setRemoval({ pile, item, impact });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      returnFocus={() =>
        didRemove.current
          ? document.querySelector<HTMLElement>(
              '.p3-undo button:not(:disabled)',
            )
          : null
      }
      title="Pile memberships"
      description="Checked means effective membership. Check an empty or mixed row to add all. Add also establishes manual membership. Use individual Remove controls to review removals."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorText error={error} />
      {busy && (
        <Button
          variant="outline"
          onClick={() => {
            cancel.current = true;
          }}
        >
          Stop after this request
        </Button>
      )}
      <output>{result}</output>
      {batchPile && (
        <Button disabled={busy} onClick={() => void add(batchPile!)}>
          {reconfirm
            ? 'Reconfirm remaining additions'
            : 'Retry remaining additions'}
        </Button>
      )}
      {!piles.length && <p>No piles yet.</p>}
      {piles.map((p) => {
        const count = items.filter((i) =>
          i.piles.some((x) => x.id === p.id),
        ).length;
        return (
          <div className="p3-membership-row" key={p.id}>
            <label>
              <input
                type="checkbox"
                aria-label={`${p.name}: ${count} of ${refs.length}`}
                aria-checked={
                  count === refs.length ? true : count ? 'mixed' : false
                }
                checked={count === refs.length}
                disabled={busy || !!batchPile}
                onChange={() => {
                  if (count !== refs.length) void add(p);
                  else if (refs.length === 1) void previewRemove(p, items[0]);
                  else
                    setResult(
                      'Use an individual Remove control to review its cleanup impact before removing.',
                    );
                }}
                ref={(node) => {
                  if (node)
                    node.indeterminate = count > 0 && count < refs.length;
                }}
              />
              {p.name} ({count}/{refs.length})
            </label>

            <Button
              variant="outline"
              disabled={busy || !!batchPile}
              onClick={() => void add(p)}
            >
              Add {refs.length > 1 ? 'all' : 'manually'}
            </Button>
            {items
              .filter((i) => i.piles.some((x) => x.id === p.id))
              .map((i) => (
                <Button
                  key={keyOf(i.ref)}
                  variant="ghost"
                  disabled={busy || !!batchPile}
                  onClick={() => void previewRemove(p, i)}
                >
                  Remove {i.name || 'item'}…
                </Button>
              ))}
          </div>
        );
      })}
      <Button disabled={busy || !!batchPile} onClick={() => setNewPile(true)}>
        New pile from selection
      </Button>
      {newPile && (
        <PileForm
          refs={refs}
          onClose={() => setNewPile(false)}
          onDone={() => {
            refresh();
            onClose();
          }}
        />
      )}
      {removal && (
        <RemoveDialog
          {...removal}
          onClose={() => setRemoval(null)}
          onDone={(out) => {
            didRemove.current = true;
            removed({
              itemName: removal.item.name,
              pileName: removal.pile.name,
              pileId: removal.pile.id,
              ref: removal.item.ref,
              operationId: out.operationId,
              revision: out.pileRevision,
            });
            refresh();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
function RemoveDialog({
  pile,
  item,
  impact,
  onClose,
  onDone,
}: {
  pile: Pile;
  item: SharedItem;
  impact: MemberImpact;
  onClose: () => void;
  onDone: (out: MemberOutcome) => void;
}) {
  const didRemove = useRef(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    intent = useRef<Intent | null>(null),
    safe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safe.current?.focus();
  }, []);
  async function remove(pin: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      intent.current ??= new Intent(`v1/piles/${pile.id}/members`, 'POST', {
        ref: item.ref,
        revision: impact.revision,
        workspaceRevision: impact.workspaceRevision,
        action: pin ? 'removeAndPin' : 'remove',
      });
      setSent(true);
      const out = await intent.current.send<MemberOutcome>();
      didRemove.current = true;
      onDone(out);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      if (isConflict(e)) setStale(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      returnFocus={() =>
        didRemove.current
          ? document.querySelector<HTMLElement>(
              '.p3-undo button:not(:disabled)',
            )
          : null
      }
      title={`Remove from ${pile.name}?`}
      description="This removes a reference. The source and other pile memberships remain."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {impact.clearsCollection && (
        <p>This also clears this text’s legacy Collection.</p>
      )}
      {impact.after.cleanup.eligible ? (
        <p>
          This removes its last cleanup protection. It is scheduled to clear{' '}
          {new Date(impact.after.cleanup.clearsAt!).toLocaleString()}. Remove
          and pin keeps it.
        </p>
      ) : (
        <p>
          After removal:{' '}
          {impact.after.cleanup.reason
            ? `kept by ${impact.after.cleanup.reason.replaceAll('_', ' ')}`
            : 'daily cleanup is off'}
          .
        </p>
      )}
      <ErrorText error={error} />
      {stale ? (
        <p>Close and select Remove again to read fresh impact and reconfirm.</p>
      ) : (
        <div className="actions">
          <Button
            ref={safe}
            disabled={busy}
            onClick={() => void remove(impact.after.cleanup.eligible)}
          >
            {sent
              ? 'Retry same removal'
              : impact.after.cleanup.eligible
                ? 'Remove and pin'
                : 'Remove from pile'}
          </Button>
          {impact.after.cleanup.eligible && !sent && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void remove(false)}
            >
              Remove and allow cleanup
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

function DeletePileDialog({
  pile,
  onClose,
  onDone,
}: {
  pile: Pile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [sent, setSent] = useState(false);
  type Impact = {
    pile: Pile;
    impactToken: string;
    exposed: { name: string; clearsAt: number }[];
    mappedCollection: boolean;
  };
  const [impact, setImpact] = useState<Impact | null>(null),
    [expose, setExpose] = useState(false),
    [ack, setAck] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    intent = useRef<Intent | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api<Impact>(`v1/piles/${pile.id}/deletion-impact`, { signal: c.signal })
      .then(setImpact)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      });
    return () => c.abort();
  }, [pile.id]);
  async function remove() {
    if (busy || !impact) return;
    setBusy(true);
    try {
      intent.current ??= new Intent(`v1/piles/${pile.id}`, 'DELETE', {
        revision: impact.pile.revision,
        impactToken: impact.impactToken,
        mode: expose ? 'expose' : 'pin',
        acknowledgeExposure: expose && ack,
      });
      setSent(true);
      await intent.current.send();
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      if (isConflict(e)) setStale(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Delete pile “${pile.name}”?`}
      description="Sources remain in your account. Pile deletion cannot be undone."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {impact ? (
        <>
          <p>
            {impact.exposed.length} currently exposed items. The default pins
            only those items. With cleanup off, no new pins are added.
          </p>
          {impact.mappedCollection && (
            <p>
              This is a mapped pile. Deletion permanently disables automatic
              linking for its exact collection key. Retry or a new pile with the
              same name cannot restore it.
            </p>
          )}
          <label>
            <input
              type="checkbox"
              disabled={busy || sent}
              checked={expose}
              onChange={(e) => {
                setExpose(e.target.checked);
                setAck(false);
              }}
            />{' '}
            Allow cleanup instead of pinning exposed items
          </label>
          {expose && (
            <label>
              <input
                type="checkbox"
                disabled={busy || sent}
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{' '}
              I understand exposed items can be cleared by daily cleanup.
            </label>
          )}
        </>
      ) : (
        <p>Reading current impact…</p>
      )}
      <ErrorText error={error} />
      {stale ? (
        <p>Close and choose Delete pile again to review fresh impact.</p>
      ) : (
        <Button
          disabled={busy || !impact || (expose && !ack)}
          onClick={() => void remove()}
        >
          {sent
            ? 'Retry same deletion'
            : expose
              ? 'Delete pile and allow cleanup'
              : 'Delete pile, pin exposed items'}
        </Button>
      )}
    </Modal>
  );
}

function PileCover({ pile, onOpen }: { pile: Pile; onOpen: () => void }) {
  const element = useRef<HTMLElement>(null),
    [previews, setPreviews] = useState<SharedItem[]>([]),
    [error, setError] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void api<PileItems>(`v1/piles/${pile.id}/items?limit=3`, {
        signal: c.signal,
      })
        .then((data) => {
          if (data.pile.revision === pile.revision) setPreviews(data.items);
          else setError(true);
        })
        .catch(() => {
          if (!c.signal.aborted) setError(true);
        });
    });
    if (element.current) observer.observe(element.current);
    return () => {
      observer.disconnect();
      c.abort();
    };
  }, [pile.id, pile.revision]);
  return (
    <article ref={element} className={`p3-cover p3-${pile.color}`}>
      <button className="p3-cover-open" onClick={onOpen}>
        <span className="p3-cover-previews">
          {previews.map((i) => (
            <span key={keyOf(i.ref)}>
              {i.preview.host ?? i.name ?? i.displayKind}
            </span>
          ))}
        </span>
        <h2>{pile.name}</h2>
        <span>
          {pile.memberCount} items · Changed{' '}
          {new Date(pile.updatedAt).toLocaleDateString()}
        </span>
        {error && <small>Open to refresh previews.</small>}
        {!pile.memberCount && <small>Empty pile — catch something here.</small>}
      </button>
    </article>
  );
}

export function DeskSurface({
  view,
  onOpenText,
  onNavigate,
  account,
}: {
  view: 'desk' | 'piles';
  onOpenText: (clip: Clip) => void;
  onNavigate: () => void;
  account: string;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const desk = useDesk(),
    [items, setItems] = useState<SharedItem[]>([]),
    [piles, setPiles] = useState<Pile[]>([]),
    [pile, setPile] = useState<Pile | null>(() =>
      view === 'piles' &&
      window.history.state?.account === account &&
      typeof window.history.state?.pileId === 'string'
        ? {
            id: window.history.state.pileId,
            name: 'Opening pile…',
            color: 'paper',
            revision: 0,
            updatedAt: 0,
          }
        : null,
    ),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [selecting, setSelecting] = useState(false),
    [query, setQuery] = useState('');
  const [form, setForm] = useState<{
      pile?: Pile;
      refs?: ItemReference[];
    } | null>(null),
    [deleting, setDeleting] = useState(false),
    [preview, setPreview] = useState<SharedItem | null>(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const anchor = useRef<string | null>(null),
    generation = useRef(0),
    movement = useRef<Intent | null>(null),
    [moveFailed, setMoveFailed] = useState(false);
  const pinRemaining = useRef<SharedItem[] | null>(null);
  const [pinsPending, setPinsPending] = useState(false);
  const loadedScope = useRef('');
  const pileId = pile?.id;
  const navigatePile = useCallback(
    (next: Pile | null, history = true) => {
      setPile(next);
      setSelected([]);
      setSelecting(false);
      setQuery('');
      if (history)
        window.history.pushState(
          { account, page: 'piles', pileId: next?.id ?? null },
          '',
        );
      requestAnimationFrame(() =>
        document.getElementById('desk-main')?.focus(),
      );
    },
    [account],
  );
  useEffect(() => {
    const restore = (e: PopStateEvent) => {
      if (e.state?.account === account && e.state.page === 'piles')
        navigatePile(
          typeof e.state.pileId === 'string'
            ? {
                id: e.state.pileId,
                name: 'Opening pile…',
                color: 'paper',
                revision: 0,
                updatedAt: 0,
              }
            : null,
          false,
        );
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [account, navigatePile]);

  useEffect(() => {
    const c = new AbortController(),
      g = ++generation.current;
    void (async () => {
      await Promise.resolve();
      if (c.signal.aborted) return;
      setLoading(true);
      setError('');
      const scope = view + ':' + (pileId ?? '');
      if (loadedScope.current !== scope) {
        setItems([]);
        setCursor(null);
        loadedScope.current = scope;
      }
      if (view === 'piles' && !pileId) {
        const data = await api<PilePage>('v1/piles?limit=100', {
          signal: c.signal,
        });
        if (g === generation.current) setPiles(data.piles);
      } else if (pileId) {
        const data = await api<PileItems>(`v1/piles/${pileId}/items`, {
          signal: c.signal,
        });
        if (g === generation.current) {
          setItems(data.items);
          setPile(data.pile);
        }
      } else {
        const data = await api<ItemsPage>('v1/items?limit=40', {
          signal: c.signal,
        });
        if (g === generation.current) {
          setItems(data.items);
          setCursor(data.nextCursor);
        }
      }
    })()
      .catch((e) => {
        if (!c.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      c.abort();
      generation.current = g + 1;
    };
  }, [view, pileId, desk.epoch]);
  async function more() {
    if (loading || !cursor) return;
    const g = generation.current;
    setLoading(true);
    try {
      const data = await api<ItemsPage>(
        `v1/items?limit=40&cursor=${encodeURIComponent(cursor)}`,
      );
      if (g === generation.current) {
        setItems((old) => [
          ...old,
          ...data.items.filter(
            (i) => !old.some((o) => keyOf(o.ref) === keyOf(i.ref)),
          ),
        ]);
        setCursor(data.nextCursor);
      }
    } catch (e) {
      if (e instanceof APIError && e.code === 'cursor_stale') {
        setSelected([]);
        desk.refresh();
        setResult(
          'Workspace changed. Restarted the list; selection was cleared.',
        );
      } else setError(errorMessage(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  const visible = pile
    ? items.filter((i) =>
        `${i.name} ${i.preview.excerpt} ${i.preview.filename} ${i.preview.host ?? ''}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      )
    : items;
  const chosen = selected.flatMap((k) => {
    const i = items.find((i) => keyOf(i.ref) === k);
    return i ? [i] : [];
  });
  function toggle(item: SharedItem, range = false) {
    const k = keyOf(item.ref);
    setSelected((old) =>
      selectionRange(
        visible.map((i) => keyOf(i.ref)),
        old,
        anchor.current,
        k,
        range,
      ),
    );
    anchor.current = k;
  }
  async function pinAll() {
    if (busy) return;
    setBusy(true);
    setError('');
    pinRemaining.current ??= [...chosen];
    setPinsPending(true);
    let done = 0;
    try {
      while (pinRemaining.current.length) {
        if (!alive.current) break;
        const item = pinRemaining.current[0];
        const current = await api<SharedItem>(itemPath(item.ref));
        if (!alive.current) break;
        if (!current.pinned)
          await api(sourcePath(item.ref), {
            method: 'PATCH',
            body: JSON.stringify({
              action: 'pin',
              pinned: true,
              revision: current.revision,
            }),
          });
        pinRemaining.current.shift();
        done++;
        setResult(
          `${done} pins confirmed; ${pinRemaining.current.length} remaining.`,
        );
      }
      pinRemaining.current = null;
      setPinsPending(false);
      desk.refresh();
    } catch (e) {
      setError(
        `${errorMessage(e)} Retry remaining pins; confirmed items will not be repeated.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function move(item: SharedItem, before: ItemReference | null) {
    if (busy || !pile) return;
    const focus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setBusy(true);
    setError('');
    try {
      movement.current ??= new Intent(`v1/piles/${pile.id}/members`, 'POST', {
        ref: item.ref,
        action: 'move',
        revision: pile.revision,
        before,
      });
      await movement.current.send();
      movement.current = null;
      setMoveFailed(false);
      setResult(`Moved ${item.name}. Order refreshed.`);
      desk.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (isConflict(e)) {
        movement.current = null;
        setMoveFailed(false);
        desk.refresh();
        setResult(
          'Pile changed. Review the refreshed order and choose a move again.',
        );
      } else setMoveFailed(true);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (focus?.isConnected) focus.focus();
      });
    }
  }
  async function open(item: SharedItem) {
    setError('');
    try {
      if (item.ref.kind === 'text')
        onOpenText(await api<Clip>(sourcePath(item.ref)));
      else setPreview(item);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setSelected([]);
        setSelecting(false);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);
  const listMode = view === 'piles' && !pile;
  return (
    <section className="p3-surface" aria-label="Shared workspace">
      <ScreenTitle
        title={pile?.name ?? (view === 'desk' ? 'Desk' : 'Piles')}
        subtitle={
          pile
            ? 'References to your saved items, in your chosen order.'
            : view === 'desk'
              ? 'Your text, images, files and links together.'
              : 'Gather related items without copying them.'
        }
        accent="page"
      />
      <div className="p3-toolbar">
        {pile && (
          <Button variant="outline" onClick={() => navigatePile(null)}>
            All piles
          </Button>
        )}
        <Button onClick={() => desk.catchInto(pile ?? undefined)}>
          {pile ? 'Catch into this pile' : 'Catch something'}
        </Button>
        {!pile && (
          <Button variant="outline" onClick={() => setForm({})}>
            New pile
          </Button>
        )}
        {pile && (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setPile(null);
                onNavigate();
              }}
            >
              Add items from Desk
            </Button>
            <details>
              <summary>More</summary>
              <Button variant="outline" onClick={() => setForm({ pile })}>
                Rename / color
              </Button>
              <Button variant="outline" onClick={() => setDeleting(true)}>
                Delete pile…
              </Button>
            </details>
          </>
        )}
        <Button variant="outline" onClick={desk.progress}>
          Collection progress
        </Button>
        <Button variant="outline" onClick={desk.refresh}>
          Refresh
        </Button>
      </div>
      <ErrorText error={error} />
      <output>{result}</output>
      {listMode ? (
        <>
          <div className="p3-grid">
            {piles.map((p) => (
              <PileCover
                key={p.id}
                pile={p}
                onOpen={() => {
                  navigatePile(p);
                }}
              />
            ))}
          </div>
          {!loading && !piles.length && (
            <p>No piles yet. Create one or catch something first.</p>
          )}
        </>
      ) : (
        <>
          {pile && (
            <label>
              Find in this pile
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, text excerpt, filename or host"
              />
              <small>
                Searches all {items.length} members by name, first 500 text
                characters, filename and host.
              </small>
            </label>
          )}
          <div className="p3-toolbar">
            <Button
              variant="outline"
              onClick={() => {
                setSelecting(!selecting);
                setSelected([]);
              }}
            >
              Select{selecting ? ': on' : ''}
            </Button>
            {selecting && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setSelected(visible.map((i) => keyOf(i.ref)))}
                >
                  Select all loaded ({visible.length})
                </Button>
                <Button variant="outline" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </>
            )}
          </div>
          {(chosen.length > 0 || pinsPending) && (
            <div className="p3-selection">
              <span>{chosen.length} selected</span>
              <Button
                disabled={busy || pinsPending}
                onClick={() => desk.membership(chosen.map((i) => i.ref))}
              >
                Add to pile
              </Button>
              <Button
                disabled={busy || chosen.length > 50}
                onClick={() => setForm({ refs: chosen.map((i) => i.ref) })}
              >
                New pile (up to 50)
              </Button>
              <Button disabled={busy} onClick={() => void pinAll()}>
                {pinsPending ? 'Retry remaining pins' : 'Pin selected'}
              </Button>
            </div>
          )}
          {moveFailed && (
            <Button
              disabled={busy}
              onClick={() => {
                if (items[0]) void move(items[0], null);
              }}
            >
              Retry same move
            </Button>
          )}
          <div className="p3-grid">
            {visible.map((item) => {
              const index = items.indexOf(item);
              return (
                <article
                  key={keyOf(item.ref)}
                  className={`p3-item ${item.pinned ? 'is-pinned' : ''}`}
                >
                  {selecting && (
                    <label className="p3-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(keyOf(item.ref))}
                        onClick={(e) => {
                          e.preventDefault();
                          toggle(item, e.shiftKey);
                        }}
                        onChange={() => {}}
                        onKeyDown={(e) => {
                          if (e.key === ' ') {
                            e.preventDefault();
                            toggle(item, e.shiftKey);
                          }
                        }}
                      />{' '}
                      Select {item.name || 'item'}
                    </label>
                  )}
                  <small>
                    {pile ? `${index + 1} of ${items.length} · ` : ''}
                    {item.preview.host ?? item.displayKind}
                  </small>
                  <h2>{item.name || 'Untitled'}</h2>
                  {item.ref.kind === 'text' && (
                    <p className="p3-excerpt">{item.preview.excerpt}</p>
                  )}
                  {item.ref.kind === 'image' && (
                    <Image
                      unoptimized
                      width={600}
                      height={400}
                      loading="lazy"
                      src={`/api/v1/images/${item.ref.id}/file`}
                      alt={item.name}
                      className="p3-thumbnail"
                    />
                  )}
                  <Protection item={item} />
                  <div className="actions">
                    {item.capabilities.open ? (
                      <a
                        className="button-secondary"
                        href={item.preview.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open {item.preview.host} ↗
                      </a>
                    ) : (
                      <Button variant="outline" onClick={() => void open(item)}>
                        {item.ref.kind === 'text'
                          ? 'Open editor'
                          : 'Preview / download'}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => desk.membership([item.ref])}
                    >
                      Add to pile / remove…
                    </Button>
                    {item.contentKind === 'link' && (
                      <Button
                        variant="outline"
                        onClick={() => setPreview(item)}
                      >
                        Edit link / delete…
                      </Button>
                    )}
                  </div>
                  {pile && (
                    <div className="p3-order" aria-label={`Order ${item.name}`}>
                      <Button
                        variant="ghost"
                        disabled={busy || moveFailed || index === 0}
                        onClick={() => void move(item, items[index - 1].ref)}
                      >
                        Move up
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={
                          busy || moveFailed || index === items.length - 1
                        }
                        onClick={() =>
                          void move(item, items[index + 2]?.ref ?? null)
                        }
                      >
                        Move down
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy || moveFailed || index === 0}
                        onClick={() => void move(item, items[0].ref)}
                      >
                        To top
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!loading && !visible.length && (
            <p>
              {query
                ? 'No matches in this pile.'
                : 'No items yet. Catch something to get started.'}
            </p>
          )}
          {cursor && (
            <Button disabled={loading} onClick={() => void more()}>
              Load more
            </Button>
          )}
        </>
      )}
      {loading && <output>Loading…</output>}
      {form && (
        <PileForm
          {...form}
          onClose={() => setForm(null)}
          onDone={desk.refresh}
        />
      )}
      {deleting && pile && (
        <DeletePileDialog
          pile={pile}
          onClose={() => setDeleting(false)}
          onDone={() => {
            setPile(null);
            desk.refresh();
          }}
        />
      )}
      {preview && (
        <ItemPreview item={preview} onClose={() => setPreview(null)} />
      )}
    </section>
  );
}

function ItemPreview({
  item,
  onClose,
}: {
  item: SharedItem;
  onClose: () => void;
}) {
  const desk = useDesk(),
    [name, setName] = useState(item.name),
    [url, setURL] = useState(item.preview.url),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const file = '/api/' + sourcePath(item.ref) + '/file';
  async function edit() {
    setBusy(true);
    try {
      const normalized = contentLink(url);
      await api(sourcePath(item.ref), {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          url: normalized,
          revision: item.revision,
        }),
      });
      desk.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item.name}
      description={item.preview.host ?? 'Preview of your saved source.'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {item.contentKind === 'link' ? (
        <>
          <label htmlFor="bookmark-title">
            Title
            <Input
              id="bookmark-title"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label htmlFor="bookmark-url">
            HTTPS URL
            <Input
              id="bookmark-url"
              value={url}
              maxLength={2048}
              onChange={(e) => setURL(e.target.value)}
            />
          </label>
          <Button disabled={busy || !name.trim()} onClick={() => void edit()}>
            Save link changes
          </Button>
          <a href={item.preview.url} target="_blank" rel="noopener noreferrer">
            Open {item.preview.host} ↗
          </a>
          <p>
            {contentProvider(item.preview.url)}. No destination is fetched until
            you open it.
          </p>
        </>
      ) : (
        <>
          {item.capabilities.preview === 'pdf' && (
            <PdfPreview url={file} name={item.name} />
          )}
          {item.capabilities.preview === 'image' && (
            <>
              <Image
                unoptimized
                width={600}
                height={400}
                src={file}
                alt={item.name}
                className="max-h-96 object-contain"
              />
              <DocumentPrintButton
                source={{ kind: 'image', url: file }}
                name={item.name}
              />
            </>
          )}
          {item.capabilities.preview === 'audio' && (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- Uploaded media has no supplied caption track.
            <audio controls src={file} />
          )}
          {item.capabilities.preview === 'video' && (
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- Uploaded media has no supplied caption track.
            <video controls src={file} />
          )}
          {item.capabilities.download && (
            <a href={file} download={item.preview.filename || item.name}>
              Download original
            </a>
          )}
          {item.ref.kind === 'image' && (
            <Button
              onClick={() =>
                void writeClipboard(
                  'image/png',
                  fetch(file).then(async (r) => {
                    if (!r.ok) throw new Error('Image unavailable');
                    return {
                      mime: 'image/png',
                      bytes: new Uint8Array(await r.arrayBuffer()),
                    };
                  }),
                ).catch((e) => setError(errorMessage(e)))
              }
            >
              Copy image
            </Button>
          )}
        </>
      )}
      <Protection item={item} />
      <hr />
      <Button variant="outline" onClick={() => setConfirm(true)}>
        Delete item everywhere…
      </Button>
      {confirm && (
        <>
          <p>
            {item.contentKind === 'link'
              ? 'Deletes this saved shortcut, not the remote site.'
              : 'Deletes this source and removes it from every pile.'}{' '}
            This cannot be undone.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api(sourcePath(item.ref), { method: 'DELETE' })
                .then(() => {
                  desk.refresh();
                  onClose();
                })
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            Confirm delete item everywhere
          </Button>
        </>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}

function CatchPanel({
  pile,
  initialText = '',
  onClose,
}: {
  pile?: Pile;
  initialText?: string;
  onClose: () => void;
}) {
  const [textDirty, setTextDirty] = useState(!!initialText);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const desk = useDesk(),
    [also, setAlso] = useState(!!pile),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [scan, setScan] = useState(false),
    [url, setURL] = useState(''),
    [title, setTitle] = useState(''),
    [large, setLarge] = useState<File | null>(null);
  const [failed, setFailed] = useState<ItemReference[]>([]),
    memberIntent = useRef<Intent | null>(null),
    savedDestination = useRef<Pile | undefined>(undefined),
    working = useRef(false);
  const linkAttempt = useRef<{ id: string; url: string; name: string } | null>(
      null,
    ),
    fileAttempt = useRef<{
      file: File;
      id: string;
      kind: 'image' | 'document';
    } | null>(null),
    [retryFile, setRetryFile] = useState<File | null>(null);
  async function addSaved(ref: ItemReference) {
    desk.refresh();
    setMessage('Saved to your account.');
    if (!alive.current) return false;
    if (!also || !pile) return true;
    savedDestination.current = pile;
    try {
      const current = await api<{ pile: Pile }>(`v1/piles/${pile.id}`);
      if (!alive.current) return false;
      memberIntent.current = new Intent(`v1/piles/${pile.id}/members`, 'POST', {
        ref,
        action: 'add',
        revision: current.pile.revision,
      });
      await memberIntent.current.send();
      memberIntent.current = null;
      setMessage(`Saved and added to ${pile.name}.`);
      desk.refresh();
      return true;
    } catch (e) {
      setFailed((old) => [...old, ref]);
      setError(`Saved, but not added to ${pile.name}. ${errorMessage(e)}`);
      if (isConflict(e)) memberIntent.current = null;
      return false;
    }
  }
  async function again() {
    if (working.current || !failed.length || !savedDestination.current) return;
    working.current = true;
    setBusy(true);
    try {
      const target = savedDestination.current,
        ref = failed[0];
      if (!memberIntent.current) {
        const fresh = await api<{ pile: Pile }>(`v1/piles/${target.id}`);
        memberIntent.current = new Intent(
          `v1/piles/${target.id}/members`,
          'POST',
          { ref, action: 'add', revision: fresh.pile.revision },
        );
      }
      await memberIntent.current.send();
      memberIntent.current = null;
      setFailed((old) => old.slice(1));
      setError('');
      setMessage(`Saved item added to ${target.name}.`);
      desk.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (isConflict(e)) memberIntent.current = null;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function upload(file: File, asDocument = false): Promise<boolean> {
    if (working.current || failed.length) return false;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      let blob: Blob | undefined;
      const image =
        !asDocument &&
        ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
      if (image) {
        try {
          const payload = await imagePayload(file);
          blob = new Blob([payload.bytes], { type: 'image/png' });
        } catch (e) {
          if (/8 MiB/.test(errorMessage(e))) {
            setLarge(file);
            return false;
          }
          throw e;
        }
      }
      if (!image && (file.size < 1 || file.size > CONTENT_FILE_LIMIT))
        throw new Error('Documents must be between 1 byte and 50 MB.');
      if (
        fileAttempt.current?.file !== file ||
        fileAttempt.current.kind !== (image ? 'image' : 'document')
      )
        fileAttempt.current = {
          file,
          id: crypto.randomUUID(),
          kind: image ? 'image' : 'document',
        };
      const attempt = fileAttempt.current;
      if (image) {
        await api(
          `v1/images/${attempt.id}?name=${encodeURIComponent(file.name.slice(0, 120))}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            body: blob,
          },
        );
      } else {
        const reserved = await post<ContentItem & { state: string }>(
          'v1/documents',
          {
            id: attempt.id,
            kind: 'file',
            name: file.name.slice(0, 120),
            filename: file.name.slice(0, 180),
            mime: declaredContentType(file),
            size: file.size,
          },
        );
        if (reserved.state !== 'ready')
          await api(`v1/documents/${attempt.id}/file`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          });
      }
      fileAttempt.current = null;
      setRetryFile(null);
      setLarge(null);
      const added = await addSaved({
        kind: image ? 'image' : 'document',
        id: attempt.id,
      });
      if (added && !scan && window.matchMedia('(max-width:767px)').matches) {
        toast.add({ title: 'Saved to your account.', type: 'success' });
        onClose();
      }
      return true;
    } catch (e) {
      setError(`${errorMessage(e)} Retry uses the same source identifier.`);
      setRetryFile(file);
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function link() {
    if (working.current || failed.length) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const normalized = contentLink(url);
      if (!title.trim()) throw new Error('Enter a title.');
      if (
        linkAttempt.current?.url !== normalized ||
        linkAttempt.current.name !== title
      )
        linkAttempt.current = {
          id: crypto.randomUUID(),
          url: normalized,
          name: title,
        };
      const saved = await post<ContentItem>('v1/documents', {
        ...linkAttempt.current,
        kind: 'link',
      });
      linkAttempt.current = null;
      setURL('');
      setTitle('');
      const added = await addSaved({ kind: 'document', id: saved.id });
      if (added && window.matchMedia('(max-width:767px)').matches) {
        toast.add({ title: 'Saved to your account.', type: 'success' });
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!busy && !url && !title) return;
    const protect = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy, url, title]);
  return (
    <Modal
      title={pile ? `Catch into ${pile.name}` : 'Catch something'}
      description="Text and images save to Clipboard. Files, scans and links save to Documents."
      onClose={() => {
        if (
          !busy &&
          !scan &&
          ((!url && !title && !textDirty) ||
            window.confirm('Discard your unsaved capture?'))
        )
          onClose();
      }}
    >
      {pile && (
        <label>
          <input
            type="checkbox"
            checked={also}
            disabled={busy || !!failed.length}
            onChange={(e) => setAlso(e.target.checked)}
          />{' '}
          Also add to this pile
        </label>
      )}
      <ClipboardText
        locked={busy || !!failed.length}
        onDirtyChange={setTextDirty}
        initialText={initialText}
        onSavingChange={setBusy}
        onSaved={async (id) => {
          setBusy(true);
          try {
            const added = await addSaved({ kind: 'text', id });
            if (added && window.matchMedia('(max-width:767px)').matches) {
              toast.add({ title: 'Saved to your account.', type: 'success' });
              onClose();
            }
          } finally {
            setBusy(false);
          }
        }}
      />
      <label className="button-secondary">
        Upload image or file
        <input
          type="file"
          disabled={busy || !!failed.length}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </label>
      <Button
        disabled={busy || !!failed.length}
        variant="outline"
        onClick={() => setScan(true)}
      >
        Scan a document
      </Button>
      {large && (
        <div>
          <p>
            This image exceeds the normalized Clipboard limit. Save the original
            as a Document (up to 50 MB)?
          </p>
          <Button disabled={busy} onClick={() => void upload(large, true)}>
            Save original as Document
          </Button>
          <Button variant="outline" onClick={() => setLarge(null)}>
            Cancel
          </Button>
        </div>
      )}
      {retryFile && (
        <Button
          disabled={busy}
          onClick={() =>
            void upload(retryFile, fileAttempt.current?.kind === 'document')
          }
        >
          Retry same upload
        </Button>
      )}
      <details>
        <summary>Add HTTPS link</summary>
        <label htmlFor="capture-url">
          URL
          <Input
            id="capture-url"
            type="url"
            value={url}
            maxLength={2048}
            disabled={busy}
            onChange={(e) => {
              setURL(e.target.value);
              if (!title) {
                try {
                  setTitle(new URL(e.target.value).hostname);
                } catch {
                  /* incomplete input */
                }
              }
            }}
          />
        </label>
        <label htmlFor="capture-title">
          Title
          <Input
            id="capture-title"
            value={title}
            maxLength={120}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <p>Saves a shortcut. No page, favicon or metadata is fetched.</p>
        <Button
          disabled={busy || !url || !title || !!failed.length}
          onClick={() => void link()}
        >
          Save link
        </Button>
      </details>
      <output>{busy ? 'Saving…' : message}</output>
      <ErrorText error={error} />
      {failed.length > 0 && (
        <Button disabled={busy} onClick={() => void again()}>
          Add again — saved source only ({failed.length})
        </Button>
      )}
      {scan && (
        <DocumentScanner
          open
          onClose={() => setScan(false)}
          onSave={(file) => upload(file, true)}
        />
      )}
    </Modal>
  );
}

/** Clipboard's existing upload path offers an explicit store choice at its limit. */
export function OversizedImage({
  file,
  onClose,
  onSaved,
}: {
  file: File;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const id = useRef(crypto.randomUUID());
  return (
    <Modal
      title="Save original as a Document?"
      description="This image exceeds the Clipboard image limit. Documents accept originals up to 50 MB. Cancel keeps it off your account."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {file.name} · {Math.ceil(file.size / 1000000)} MB
      </p>
      <ErrorText error={error} />
      <Button
        disabled={busy || file.size > CONTENT_FILE_LIMIT}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void (async () => {
            const saved = await post<ContentItem & { state: string }>(
              'v1/documents',
              {
                id: id.current,
                kind: 'file',
                name: file.name.slice(0, 120),
                filename: file.name.slice(0, 180),
                mime: declaredContentType(file),
                size: file.size,
              },
            );
            if (saved.state !== 'ready')
              await api(`v1/documents/${id.current}/file`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: file,
              });
            onSaved();
            onClose();
          })()
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        Save original as Document
      </Button>
      <Button disabled={busy} variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </Modal>
  );
}
