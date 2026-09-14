'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, errorMessage, download } from '@/lib/client';
import {
  emptyTools,
  validateTools,
  type WorkspaceTools,
} from '@/lib/workspace-tools';
const Context = createContext({
  account: '',
  tools: emptyTools,
  collections: [] as string[],
  tags: [] as string[],
  reload: () => {},
});
export const useWorkspaceTools = () => useContext(Context);
export function WorkspaceToolsProvider({
  account,
  children,
}: {
  account: string;
  children: ReactNode;
}) {
  const [tools, setTools] = useState(emptyTools),
    [organization, setOrganization] = useState({
      collections: [] as string[],
      tags: [] as string[],
    });
  const reload = () => {
    void api<WorkspaceTools>('workspace-tools')
      .then(setTools)
      .catch(() => {});
    void api<typeof organization>('organization')
      .then(setOrganization)
      .catch(() => {});
  };
  useEffect(() => {
    reload();
  }, [account]);
  return (
    <Context.Provider
      value={{
        account,
        tools,
        collections: [
          ...new Set([...tools.collections, ...organization.collections]),
        ].sort(),
        tags: organization.tags,
        reload,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function WorkspaceToolsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { tools, reload } = useWorkspaceTools();
  const [draft, setDraft] = useState(tools),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await api<WorkspaceTools>('workspace-tools', {
        method: 'PUT',
        body: JSON.stringify(
          validateTools({
            ...draft,
            collections: draft.collections.filter((v) => v.trim()),
            vocabulary: draft.vocabulary.filter((v) => v.trim()),
          }),
        ),
      });
      setDraft(saved);
      reload();
      setNotice('Saved across your devices.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>Make this workspace yours</DialogTitle>
        <DialogDescription>
          Collections, preferred spellings, and reusable voice templates.
        </DialogDescription>
        <fieldset disabled={busy} className="space-y-5">
          <label className="field-label" htmlFor="tools-collections">
            Project collections
            <Textarea
              id="tools-collections"
              className="field min-h-24"
              value={draft.collections.join('\n')}
              onChange={(e) =>
                setDraft({ ...draft, collections: e.target.value.split('\n') })
              }
              placeholder={'One per line: Work, Personal, Next big idea'}
            />
          </label>
          <p className="subtle text-sm">
            Choose or type a collection in any thought’s editor. Removing a
            suggestion here keeps existing thoughts and their collection labels.
          </p>
          <label className="field-label" htmlFor="tools-vocabulary">
            Personal vocabulary
            <Textarea
              id="tools-vocabulary"
              className="field min-h-24"
              value={draft.vocabulary.join('\n')}
              onChange={(e) =>
                setDraft({ ...draft, vocabulary: e.target.value.split('\n') })
              }
              placeholder={
                'Preferred spellings, one per line\nDictation Operative\nOppenheimer'
              }
            />
          </label>
          <p className="subtle text-sm">
            Up to 60 names or terms, 700 characters total. Used as spelling
            hints for transcription and writing tools; always review the result.
          </p>
          <div className="section-line">
            <h3>Voice templates</h3>
            <Button
              variant="outline"
              onClick={() =>
                setDraft({
                  ...draft,
                  templates: [
                    ...draft.templates,
                    {
                      id: crypto.randomUUID(),
                      name: 'New template',
                      instructions: '',
                    },
                  ],
                })
              }
              disabled={draft.templates.length >= 30}
            >
              Add template
            </Button>
          </div>
          {draft.templates.map((t, i) => (
            <div className="panel space-y-3" key={t.id}>
              <label className="field-label" htmlFor={`tpl-name-${t.id}`}>
                Template name
                <Input
                  id={`tpl-name-${t.id}`}
                  className="field"
                  maxLength={60}
                  value={t.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      templates: draft.templates.map((v, j) =>
                        j === i ? { ...v, name: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label className="field-label" htmlFor={`tpl-body-${t.id}`}>
                How should your words be shaped?
                <Textarea
                  id={`tpl-body-${t.id}`}
                  className="field"
                  maxLength={2000}
                  value={t.instructions}
                  placeholder="Turn my notes into a project brief with Goal, Decisions, and Next steps. Keep my tone."
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      templates: draft.templates.map((v, j) =>
                        j === i ? { ...v, instructions: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    templates: draft.templates.filter((v) => v.id !== t.id),
                  })
                }
              >
                Remove template
              </Button>
            </div>
          ))}
          <div className="actions">
            <Button onClick={() => void save()}>Save workspace tools</Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const saved = await api<WorkspaceTools>('workspace-tools');
                  setDraft(saved);
                  setError('');
                  setNotice('Reloaded saved tools.');
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Reload saved tools
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(
                  'do-workspace-tools.json',
                  JSON.stringify(
                    { app: 'DO-tools', version: 2, ...tools },
                    null,
                    2,
                  ),
                  'application/json',
                )
              }
            >
              Export tools
            </Button>
            <label className="control cursor-pointer" htmlFor="tools-import">
              Import tools
              <Input
                id="tools-import"
                type="file"
                accept="application/json"
                className="block text-sm"
                onChange={async (e) => {
                  try {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 100000)
                      throw new Error('Choose a tools export under 100 KB.');
                    const v = JSON.parse(await f.text());
                    if (v.app !== 'DO-tools')
                      throw new Error('Choose a DO workspace tools export.');
                    setDraft({ ...validateTools(v), revision: tools.revision });
                    setNotice('Imported for review. Save to apply.');
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <Alert variant="destructive" className="error-message" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && <output>{notice}</output>}
      </DialogContent>
    </Dialog>
  );
}
export function TemplatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { tools } = useWorkspaceTools();
  return (
    <label className="field-label">
      Voice template
      <NativeSelect
        className="field"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Use the selected writing mode</option>
        {tools.templates.map((t) => (
          <option value={t.id} key={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
