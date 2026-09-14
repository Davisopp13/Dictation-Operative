import { AppError, object, text, id, revision } from './domain';
export type VoiceTemplate = { id: string; name: string; instructions: string };
export type WorkspaceTools = {
  revision: number;
  collections: string[];
  vocabulary: string[];
  templates: VoiceTemplate[];
};
export const emptyTools: WorkspaceTools = {
  revision: 1,
  collections: [],
  vocabulary: [],
  templates: [],
};
export function validateTools(value: unknown): WorkspaceTools {
  const data = object(value);
  const strings = (
    value: unknown,
    name: string,
    count: number,
    length: number,
  ) => {
    if (!Array.isArray(value) || value.length > count)
      throw new AppError(`Use up to ${count} ${name}.`);
    const items = value.map((v) => text(v, name, length));
    if (new Set(items.map((v) => v.toLowerCase())).size !== items.length)
      throw new AppError(`Remove duplicate ${name}.`);
    return items;
  };
  if (!Array.isArray(data.templates) || data.templates.length > 30)
    throw new AppError('Use up to 30 templates.');
  const templates = data.templates.map((v) => {
    const t = object(v);
    return {
      id: id(t.id),
      name: text(t.name, 'Template name', 60),
      instructions: text(t.instructions, 'Instructions', 2000),
    };
  });
  if (new Set(templates.map((t) => t.id)).size !== templates.length)
    throw new AppError('Duplicate template identifiers.');
  const vocabulary = strings(data.vocabulary, 'preferred spellings', 60, 80);
  if (vocabulary.join(', ').length > 700)
    throw new AppError('Keep preferred spellings under 700 characters total.');
  return {
    revision: revision(data.revision),
    collections: strings(data.collections, 'collections', 100, 60),
    vocabulary,
    templates,
  };
}
export async function getTools(
  db: D1Database,
  owner: string,
): Promise<WorkspaceTools> {
  const r = await db
    .prepare('SELECT data,revision FROM workspace_tools WHERE owner=?')
    .bind(owner)
    .first<{ data: string; revision: number }>();
  return r
    ? { ...JSON.parse(r.data), revision: r.revision }
    : { ...emptyTools };
}
export async function saveTools(db: D1Database, owner: string, input: unknown) {
  const data = validateTools(input);
  // Revision 1 represents both an empty workspace and the first stored version.
  const r = await db
    .prepare(
      'INSERT INTO workspace_tools(owner,data,revision) SELECT ?,?,2 WHERE ?=1 ON CONFLICT(owner) DO UPDATE SET data=excluded.data,revision=workspace_tools.revision+1 WHERE workspace_tools.revision=? RETURNING revision',
    )
    .bind(owner, JSON.stringify(data), data.revision, data.revision)
    .first<{ revision: number }>();
  // For existing rows above revision 1, UPDATE separately; the INSERT's SELECT intentionally creates no row.
  const updated =
    r ??
    (data.revision > 1
      ? await db
          .prepare(
            'UPDATE workspace_tools SET data=?,revision=revision+1 WHERE owner=? AND revision=? RETURNING revision',
          )
          .bind(JSON.stringify(data), owner, data.revision)
          .first<{ revision: number }>()
      : null);
  if (!updated)
    throw new AppError(
      'Workspace tools changed elsewhere. Reload them before saving your changes.',
      409,
    );
  return { ...data, revision: updated.revision };
}
