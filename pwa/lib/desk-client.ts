import { api, APIError } from './client';
import type { SharedItem, ItemReference } from './shared-items';
export type Pile = {
  id: string;
  name: string;
  color: string;
  revision: number;
  memberCount?: number;
  updatedAt: number;
};
export type PilePage = {
  piles: Pile[];
  nextCursor: string | null;
  revision: number;
};
export type ItemsPage = {
  items: SharedItem[];
  nextCursor: string | null;
  revision: number;
};
export type PileItems = { pile: Pile; items: SharedItem[]; revision: number };
export type BackfillStatus = {
  pending: number;
  ready: number;
  pileCapacity: number;
  memberCapacity: number;
  suppressedPending: number;
  mappedKeys: number;
  suppressedKeys: number;
  mappedMembers: number;
  complete: boolean;
  revision: number;
};
export type MemberOutcome = {
  operationId: string;
  pileRevision: number;
  changed: boolean;
  item: Pick<SharedItem, 'ref' | 'revision' | 'pinned' | 'cleanup' | 'piles'>;
};
export type MemberImpact = {
  revision: number;
  workspaceRevision: number;
  clearsCollection: boolean;
  after: MemberOutcome['item'];
};
export const keyOf = (ref: ItemReference) => `${ref.kind}:${ref.id}`;
export const itemPath = (ref: ItemReference) =>
  `v1/items/${ref.kind}/${ref.id}`;
export const sourcePath = (ref: ItemReference) =>
  `v1/${ref.kind === 'text' ? 'text' : ref.kind === 'image' ? 'images' : 'documents'}/${ref.id}`;
export const isConflict = (error: unknown) =>
  error instanceof APIError &&
  (error.status === 409 || error.status === 410 || error.status === 404);
export function organizationMessage(item?: Pick<SharedItem, 'organization'>) {
  const state = item?.organization?.state;
  if (!state || state === 'unknown')
    return 'Saved; organization status unavailable.';
  if (item?.organization.pending)
    return 'Saved to your account. Collection not yet added to a pile.';
  if (state === 'suppressed_settled')
    return 'Saved. Automatic linking is disabled for this collection.';
  if (state === 'mapped') return 'Saved. Collection linked to its pile.';
  return 'Saved to your account.';
}
/** Keep the exact serialized request until its outcome is known. A conflict
 * needs a new user confirmation; a transport failure retries the same bytes. */
export class Intent {
  readonly body: string;
  constructor(
    readonly path: string,
    readonly method: string,
    data: Record<string, unknown>,
  ) {
    this.body = JSON.stringify({ operationId: crypto.randomUUID(), ...data });
  }
  send<T>() {
    return api<T>(this.path, { method: this.method, body: this.body });
  }
}
export function selectionRange(
  order: string[],
  selected: string[],
  anchor: string | null,
  target: string,
  range: boolean,
) {
  if (range && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor),
      b = order.indexOf(target);
    return [
      ...new Set([
        ...selected,
        ...order.slice(Math.min(a, b), Math.max(a, b) + 1),
      ]),
    ];
  }
  return selected.includes(target)
    ? selected.filter((k) => k !== target)
    : [...selected, target];
}

/** One per-dialog queue. A lost response retains its exact request; successful
 * steps leave the queue permanently. Conflicts require an explicit new intent. */
export class MembershipBatch {
  readonly remaining: ItemReference[];
  done = 0;
  needsConfirmation = false;
  private intent: Intent | null = null;
  private inFlight = false;
  constructor(
    readonly pile: Pile,
    refs: ItemReference[],
  ) {
    this.remaining = [...refs];
  }
  confirm() {
    this.needsConfirmation = false;
  }
  async step(stopped: () => boolean = () => false) {
    if (this.inFlight)
      throw new Error('A membership request is already in flight.');
    if (this.needsConfirmation)
      throw new Error('Refresh and reconfirm the remaining additions.');
    if (!this.remaining.length) return;
    this.inFlight = true;
    try {
      if (stopped())
        throw new Error(
          'Stopped between requests. Confirmed additions stay saved.',
        );
      if (!this.intent) {
        const current = await api<{ pile: Pile }>(`v1/piles/${this.pile.id}`);
        this.intent = new Intent(`v1/piles/${this.pile.id}/members`, 'POST', {
          ref: this.remaining[0],
          action: 'add',
          revision: current.pile.revision,
        });
      }
      if (stopped())
        throw new Error(
          'Stopped between requests. Confirmed additions stay saved.',
        );
      const result = await this.intent.send<MemberOutcome>();
      this.remaining.shift();
      this.done++;
      this.intent = null;
      return result;
    } catch (error) {
      if (isConflict(error)) {
        this.intent = null;
        this.needsConfirmation = true;
      }
      throw error;
    } finally {
      this.inFlight = false;
    }
  }
}
