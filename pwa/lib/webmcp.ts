import { id, object, text, clipKind, type ClipKind } from './domain';
type Actions = {
  search: (query: string) => Promise<unknown>;
  open: (id: string) => Promise<unknown>;
  stage: (input: {
    text: string;
    kind: ClipKind;
    context: string;
  }) => Promise<unknown>;
};
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => Promise<unknown>;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function installWebTools(actions: Actions, context?: Context) {
  const modelContext =
    context ??
    (typeof document === 'undefined'
      ? undefined
      : (document as Document & { modelContext?: Context }).modelContext);
  if (!modelContext?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: Tool[] = [
    {
      name: 'search_thoughts',
      title: 'Search thoughts',
      description:
        'Search the signed-in user’s saved history and show the matching results. Returns titles and identifiers.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 200 } },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) =>
        actions.search(text(object(input).query, 'Search', 200, true)),
    },
    {
      name: 'open_thought',
      title: 'Open thought',
      description:
        'Open a saved thought in the editor for review. Does not change its contents.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => actions.open(id(object(input).id)),
    },
    {
      name: 'stage_text_capture',
      title: 'Stage a thought',
      description:
        'Place text into the capture form for the user to review and save. Does not record, call AI, save, copy, or share.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 20000 },
          kind: { type: 'string', enum: ['note', 'reply', 'prompt'] },
          context: { type: 'string', maxLength: 10000 },
        },
        required: ['text', 'kind'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        const data = object(input),
          kind = clipKind(data.kind);
        if (kind === 'combined') throw new Error('Use note, reply, or prompt.');
        return actions.stage({
          text: text(data.text),
          kind,
          context: text(data.context ?? '', 'Incoming message', 10000, true),
        });
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        modelContext.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional API; regular UI remains available. */
    }
  }
  return () => lifecycle.abort();
}
