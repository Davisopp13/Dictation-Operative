export type ClipKind = 'note' | 'reply' | 'prompt' | 'combined';
export type VersionKind =
  | 'original'
  | 'cleaned'
  | 'rewritten'
  | 'edited'
  | 'appended'
  | 'restored';
export type Version = {
  id: string;
  kind: VersionKind;
  text: string;
  createdAt: number;
};
export type Segment = { id: string; text: string; createdAt: number };
export type Clip = {
  id: string;
  title: string;
  kind: ClipKind;
  content: string;
  original: string;
  context: string;
  collection: string;
  tags: string[];
  pinned: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
  segments: Segment[];
  versions: Version[];
};
export type ClipSummary = Pick<
  Clip,
  | 'id'
  | 'title'
  | 'kind'
  | 'content'
  | 'collection'
  | 'tags'
  | 'pinned'
  | 'revision'
  | 'createdAt'
  | 'updatedAt'
>;
export type Transform =
  | 'clean'
  | 'rewrite'
  | 'reply'
  | 'prompt'
  | 'email'
  | 'update'
  | 'checklist';
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('Expected an object.');
  return value as Record<string, unknown>;
}
export function text(
  value: unknown,
  name = 'Text',
  max = 20000,
  empty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new AppError(
      `${name} must ${empty ? 'be text' : 'not be empty'} and stay under ${max.toLocaleString()} characters.`,
    );
  return value.trim();
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value))
    throw new AppError('Invalid clip identifier.');
  return value;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new AppError('A valid revision is required.');
  return Number(value);
}
export function clipKind(value: unknown): ClipKind {
  if (!['note', 'reply', 'prompt', 'combined'].includes(String(value)))
    throw new AppError('Unknown capture type.');
  return value as ClipKind;
}
export function transformKind(value: unknown): Transform {
  if (
    ![
      'clean',
      'rewrite',
      'reply',
      'prompt',
      'email',
      'update',
      'checklist',
    ].includes(String(value))
  )
    throw new AppError('Unknown writing action.');
  return value as Transform;
}
export function newClip(
  input: Record<string, unknown>,
  now = Date.now(),
): Clip {
  const content = text(input.content),
    kind = clipKind(input.kind ?? 'note');
  return {
    id: id(input.id),
    title: input.title
      ? text(input.title, 'Title', 120)
      : content.slice(0, 65).replace(/\n/g, ' '),
    kind,
    content,
    original: content,
    context: text(input.context ?? '', 'Incoming message', 10000, true),
    collection: text(input.collection ?? '', 'Collection', 60, true),
    tags: tagList(input.tags ?? []),
    pinned: input.pinned === true,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    segments: [{ id: crypto.randomUUID(), text: content, createdAt: now }],
    versions: [
      {
        id: crypto.randomUUID(),
        kind: 'original',
        text: content,
        createdAt: now,
      },
    ],
  };
}
export function changeClip(
  current: Clip,
  input: Record<string, unknown>,
  now = Date.now(),
): Clip {
  if (input.action === 'append' && input.segmentId !== undefined) {
    const existing = current.segments.find(
      (segment) => segment.id === id(input.segmentId),
    );
    if (existing) {
      if (existing.text !== text(input.content))
        throw new AppError(
          'This recording was already saved with different words.',
          409,
        );
      return current;
    }
  }
  if (revision(input.revision) !== current.revision)
    throw new AppError(
      'This thought changed in another tab. Reopen it before saving; your unsaved text is still here.',
      409,
    );
  const next: Clip = {
    ...current,
    segments: [...current.segments],
    versions: [...current.versions],
    revision: current.revision + 1,
    updatedAt: now,
  };
  let versionKind: VersionKind | undefined;
  switch (input.action) {
    case 'organize':
      next.collection = text(input.collection ?? '', 'Collection', 60, true);
      next.tags = tagList(input.tags ?? []);
      break;
    case 'pin':
      if (typeof input.pinned !== 'boolean')
        throw new AppError('Choose whether to pin this thought.');
      next.pinned = input.pinned;
      break;
    case 'rename':
      next.title = text(input.title, 'Title', 120);
      break;
    case 'edit':
      next.content = text(input.content);
      if (input.title !== undefined)
        next.title = text(input.title, 'Title', 120);
      versionKind = 'edited';
      break;
    case 'transform':
      next.content = text(input.content);
      if (!['cleaned', 'rewritten'].includes(String(input.versionKind)))
        throw new AppError('Invalid version type.');
      versionKind = input.versionKind as VersionKind;
      break;
    case 'append': {
      const addition = text(input.content);
      next.content = text(current.content + '\n\n' + addition);
      next.original = text(current.original + '\n\n' + addition);
      next.segments.push({
        id:
          input.segmentId === undefined
            ? crypto.randomUUID()
            : id(input.segmentId),
        text: addition,
        createdAt: now,
      });
      versionKind = 'appended';
      break;
    }
    case 'without-segment': {
      const segmentId = id(input.segmentId);
      if (!current.segments.some((segment) => segment.id === segmentId))
        throw new AppError('Segment not found.', 404);
      next.content = text(
        current.segments
          .filter((segment) => segment.id !== segmentId)
          .map((segment) => segment.text)
          .join('\n\n'),
      );
      versionKind = 'edited';
      break;
    }
    case 'restore': {
      const v = current.versions.find((v) => v.id === input.versionId);
      if (!v) throw new AppError('Version not found.', 404);
      next.content = v.text;
      versionKind = 'restored';
      break;
    }
    case 'restore-original':
      next.content = current.original;
      versionKind = 'restored';
      break;
    default:
      throw new AppError('Unknown edit action.');
  }
  if (versionKind) {
    if (next.versions.length >= 300)
      throw new AppError(
        'This thought has 300 saved versions. Export it or start a new thought to keep editing.',
      );
    next.versions.push({
      id: crypto.randomUUID(),
      kind: versionKind,
      text: next.content,
      createdAt: now,
    });
  }
  if (JSON.stringify(next).length > 850000)
    throw new AppError(
      'This thought is full. Export it or start a new thought to continue.',
    );
  return next;
}
export function combineTexts(clips: Pick<Clip, 'content'>[]): string {
  if (clips.length < 2 || clips.length > 20)
    throw new AppError('Choose between 2 and 20 thoughts.');
  return text(clips.map((c) => c.content).join('\n\n'), 'Combined text');
}

export function tagList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new AppError('Use up to 12 tags.');
  return [...new Set(value.map((v) => text(v, 'Tag', 40).toLocaleLowerCase()))];
}
