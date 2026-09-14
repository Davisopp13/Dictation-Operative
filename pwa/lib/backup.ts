import {
  AppError,
  object,
  text,
  id,
  clipKind,
  tagList,
  type Clip,
  type VersionKind,
} from './domain';
function timestamp(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Date.now() + 86400000
  )
    throw new AppError('Invalid backup timestamp.');
  return value;
}
export function importClip(value: unknown): Clip {
  const input = object(value);
  if (
    !Array.isArray(input.segments) ||
    input.segments.length < 1 ||
    input.segments.length > 300 ||
    !Array.isArray(input.versions) ||
    input.versions.length < 1 ||
    input.versions.length > 300
  )
    throw new AppError('This backup has invalid source segments or versions.');
  const segments = input.segments.map((value) => {
    const item = object(value);
    return {
      id: id(item.id),
      text: text(item.text),
      createdAt: timestamp(item.createdAt),
    };
  });
  const versions = input.versions.map((value) => {
    const item = object(value);
    if (
      ![
        'original',
        'cleaned',
        'rewritten',
        'edited',
        'appended',
        'restored',
      ].includes(String(item.kind))
    )
      throw new AppError('This backup has an unknown version type.');
    return {
      id: id(item.id),
      text: text(item.text),
      kind: item.kind as VersionKind,
      createdAt: timestamp(item.createdAt),
    };
  });
  const clip: Clip = {
    id: id(input.id),
    title: text(input.title, 'Title', 120),
    kind: clipKind(input.kind),
    content: text(input.content),
    original: text(input.original),
    context: text(input.context ?? '', 'Incoming message', 10000, true),
    collection: text(input.collection ?? '', 'Collection', 60, true),
    tags: tagList(input.tags ?? []),
    pinned: input.pinned === true,
    revision: 1,
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    segments,
    versions,
  };
  if (
    segments.map((s) => s.text).join('\n\n') !== clip.original ||
    versions[versions.length - 1].text !== clip.content
  )
    throw new AppError(
      'The original, segments, or latest version in this backup do not agree.',
    );
  if (
    new Set(segments.map((s) => s.id)).size !== segments.length ||
    new Set(versions.map((v) => v.id)).size !== versions.length
  )
    throw new AppError('This backup contains duplicate versions or segments.');
  if (JSON.stringify(clip).length > 850000)
    throw new AppError('This backup thought exceeds the size limit.');
  return clip;
}
export function parseBackup(value: unknown): Clip[] {
  const data = object(value);
  if (
    data.app !== 'DO' ||
    data.version !== 1 ||
    !Array.isArray(data.clips) ||
    data.clips.length > 2000
  )
    throw new AppError(
      'Choose a DO V1 library export containing up to 2,000 thoughts.',
    );
  return data.clips.map(importClip);
}
export async function importedId(owner: string, originalId: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(owner + ':import:' + originalId),
  );
  return (
    'import-' +
    Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  );
}
