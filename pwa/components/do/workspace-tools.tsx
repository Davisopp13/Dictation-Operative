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
        <DialogTitle>Collections</DialogTitle>
        <DialogDescription>
          Suggested collection names for organizing saved text.
        </DialogDescription>
        <fieldset disabled={busy} className="space-y-5">
          <label className="field-label" htmlFor="tools-collections">
            Collections
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
            Choose or type a collection when editing saved text. Removing a
            suggestion here keeps existing items and their collection labels.
          </p>
          <div className="actions">
            <Button onClick={() => void save()}>Save collections</Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const saved = await api<WorkspaceTools>('workspace-tools');
                  setDraft(saved);
                  setError('');
                  setNotice('Reloaded saved collections.');
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              Reload saved
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
              Export
            </Button>
            <label className="control cursor-pointer" htmlFor="tools-import">
              Import
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
                      throw new Error('Choose an export under 100 KB.');
                    const v = JSON.parse(await f.text());
                    if (v.app !== 'DO-tools')
                      throw new Error('Choose a collections export from this workspace.');
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
