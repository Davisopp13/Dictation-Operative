'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Pin,
  Copy,
  Share2,
  Plus,
  Save,
  Undo2,
  Sparkles,
  Trash2,
  Download,
  LoaderCircle,
  ArrowLeft,
  MoreVertical,
  Smartphone,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/toast';
import { useWorkspaceTools, TemplatePicker } from './workspace-tools';
import { Recorder } from './recorder';
import { api, post, errorMessage, download } from '@/lib/client';
import { type Clip, type Transform } from '@/lib/domain';
type Props = {
  clip: Clip | null;
  onClose: () => void;
  onSync: () => void;
  onUpdate: (clip: Clip) => void;
  onDelete: (id: string) => void;
  ensureCloud: () => boolean;
};
export function ClipEditor({
  clip,
  onClose,
  onSync,
  onUpdate,
  onDelete,
  ensureCloud,
}: Props) {
  const organization = useWorkspaceTools();
  const shapeMenu = useRef<HTMLDetailsElement>(null);
  const [writingFeedback, setWritingFeedback] = useState<{
    kind: 'working' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [templateId, setTemplateId] = useState(''),
    [collection, setCollection] = useState(clip?.collection ?? ''),
    [tags, setTags] = useState((clip?.tags ?? []).join(', '));
  const [draft, setDraft] = useState(clip?.content ?? ''),
    [title, setTitle] = useState(clip?.title ?? ''),
    [tab, setTab] = useState('draft'),
    [adding, setAdding] = useState(false),
    [addition, setAddition] = useState(''),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [, setLastNotice] = useState(''),
    [remove, setRemove] = useState(false),
    [discard, setDiscard] = useState(false),
    [copyText, setCopyText] = useState<string | null>(null);
  const dirty = !!clip && (draft !== clip.content || title !== clip.title),
    locked = busy || recording;
  // Feedback goes to the shared toast viewport instead of the bottom of a
  // scrolling sheet, where it was routinely off-screen.
  const setNotice = useCallback((text: string) => {
    setLastNotice(text);
    if (text) toast.add({ title: text, type: 'success' });
  }, []);
  const setError = useCallback((text: string) => {
    if (text) toast.add({ title: text, type: 'error' });
  }, []);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (dirty || (adding && addition)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, adding, addition]);
  async function change(data: Record<string, unknown>): Promise<Clip> {
    if (!clip) throw new Error('Open a thought first.');
    const updated = await api<Clip>('clips/' + clip.id, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, revision: clip.revision }),
    });
    setDraft(updated.content);
    setTitle(updated.title);
    onUpdate(updated);
    return updated;
  }
  async function action(
    fn: () => Promise<void>,
    reportError: (text: string) => void = setError,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      reportError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!clip) return;
    await action(async () => {
      await change({ action: 'edit', content: draft, title });
      setNotice('Saved to Clipboard.');
    });
  }
  async function transform(kind: Transform, custom = '') {
    if (dirty) {
      setError('Save or undo your edits before using a writing tool.');
      return;
    }
    if (!ensureCloud()) return;
    if (shapeMenu.current) {
      shapeMenu.current.querySelector('summary')?.focus();
      shapeMenu.current.open = false;
    }
    setWritingFeedback({ kind: 'working', text: 'Shaping your words…' });
    await action(
      async () => {
        const result = await post<{ text: string }>('transform', {
          kind,
          templateId: custom || undefined,
          text: draft,
          context: clip?.context ?? '',
        });
        await change({
          action: 'transform',
          content: result.text,
          versionKind: kind === 'clean' ? 'cleaned' : 'rewritten',
        });
        setTab('draft');
        setWritingFeedback({
          kind: 'success',
          text: 'New version saved. Your original is preserved.',
        });
      },
      (text) => setWritingFeedback({ kind: 'error', text }),
    );
  }
  async function copy(value: string) {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(value);
      setNotice('Copied to your clipboard.');
    } catch {
      setCopyText(value);
    }
  }
  async function share() {
    if (!clip) return;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: draft });
        setNotice('Share sheet opened.');
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError'))
          setError('Sharing isn’t available here. Use Copy or Export instead.');
      }
    } else await copy(draft);
  }
  function close() {
    if (locked) return;
    if (dirty || addition) {
      setDiscard(true);
      return;
    }
    onClose();
  }
  return (
    <>
      {/* UNVERIFIED: focus containment. Focus was once seen tabbing out of
          this sheet into the workspace behind it, and the popup carries
          role="dialog" without aria-modal. Setting base-ui's `modal` stopped
          Tab from moving at all, so it was reverted. Neither behaviour could
          be reproduced reliably, because the browser harness used here does
          not dispatch keyboard activation (a plain <button> records zero
          activations from Enter and Space). Needs a real keyboard and
          VoiceOver before anything is changed here. */}
      <Sheet
        open={!!clip}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <SheetContent className="clip-sheet" showCloseButton={false}>
          <SheetHeader>
            <div className="section-line">
              <div>
                <SheetTitle>Your thought</SheetTitle>
                <SheetDescription>
                  {clip ? new Date(clip.createdAt).toLocaleString() : ''}
                </SheetDescription>
              </div>
              <Button
                className="control"
                variant="ghost"
                onClick={close}
                disabled={locked}
              >
                <ArrowLeft /> Done
              </Button>
            </div>
          </SheetHeader>
          {clip && (
            <div className="editor-body">
              <details className="editor-organization">
                <summary>Collection and tags</summary>
                <div className="space-y-2">
                  <label className="field-label">
                    Collection
                    <Input
                      className="field"
                      list="do-collections"
                      maxLength={60}
                      value={collection}
                      disabled={locked}
                      onChange={(e) => setCollection(e.target.value)}
                    />
                    <datalist
                      id="do-collections"
                      aria-label="Collection suggestions"
                    >
                      {organization.collections.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label className="field-label" htmlFor="clip-tags">
                    Tags
                    <Input
                      id="clip-tags"
                      className="field"
                      value={tags}
                      disabled={locked}
                      placeholder="work, ideas, follow-up"
                      onChange={(e) => setTags(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={locked || dirty}
                    onClick={() =>
                      void action(async () => {
                        await change({
                          action: 'organize',
                          collection,
                          tags: tags
                            .split(',')
                            .map((v) => v.trim())
                            .filter(Boolean),
                        });
                        organization.reload();
                        setNotice('Organization saved.');
                      })
                    }
                  >
                    Save organization
                  </Button>
                </div>
              </details>
              <label htmlFor="clip-title" className="field-label">
                Title
              </label>
              <Input
                className="field title-field"
                id="clip-title"
                value={title}
                disabled={locked}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
              {/* One primary action. Everything that used to compete with it
                  at equal weight now sits behind the overflow. */}
              <div className="actions editor-actions">
                <Button
                  className="control primary-action"
                  onClick={() => void copy(draft)}
                  disabled={!draft}
                >
                  <Copy /> Copy
                </Button>
                <Button
                  className="control"
                  variant={clip.pinned ? 'secondary' : 'outline'}
                  disabled={locked || dirty}
                  aria-pressed={clip.pinned}
                  onClick={() =>
                    void action(async () => {
                      await change({ action: 'pin', pinned: !clip.pinned });
                    })
                  }
                >
                  <Pin fill={clip.pinned ? 'currentColor' : 'none'} />
                  {clip.pinned ? 'Pinned' : 'Pin'}
                </Button>
                <details className="overflow-menu">
                  <summary
                    className="control icon-control"
                    aria-label="More actions for this thought"
                  >
                    <MoreVertical size={18} />
                  </summary>
                  <div className="overflow-sheet">
                    <button
                      type="button"
                      disabled={!draft || dirty}
                      onClick={onSync}
                    >
                      <Smartphone size={16} /> Send to device
                    </button>
                    <button
                      type="button"
                      onClick={() => void share()}
                      disabled={!draft}
                    >
                      <Share2 size={16} /> Share
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download(
                          (title || 'thought')
                            .replace(/[^a-zA-Z0-9 -]/g, '')
                            .slice(0, 60) + '.txt',
                          draft,
                        )
                      }
                      disabled={!draft}
                    >
                      <Download size={16} /> Export text
                    </button>
                    <hr />
                    <button
                      type="button"
                      className="danger"
                      disabled={locked}
                      onClick={() => setRemove(true)}
                    >
                      <Trash2 size={16} /> Delete thought
                    </button>
                  </div>
                </details>
              </div>
              <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                <TabsList className="editor-tabs">
                  <TabsTrigger value="draft">Current draft</TabsTrigger>
                  <TabsTrigger value="original">Original</TabsTrigger>
                  <TabsTrigger value="versions">
                    Versions ({clip.versions.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="draft">
                  <label className="sr-only" htmlFor="clip-draft">
                    Edit thought
                  </label>
                  <Textarea
                    id="clip-draft"
                    className="field draft-field"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={20000}
                    disabled={locked}
                  />
                  <div className="section-line mt-3">
                    <span className="subtle text-sm">
                      {draft.trim() ? draft.trim().split(/\s+/).length : 0}{' '}
                      words · {dirty ? 'Unsaved changes' : 'Saved'}
                    </span>
                    <div className="actions m-0">
                      <Button
                        variant="ghost"
                        className="control"
                        disabled={!dirty || locked}
                        onClick={() => {
                          setDraft(clip.content);
                          setTitle(clip.title);
                        }}
                      >
                        Undo edits
                      </Button>
                      <Button
                        className="control"
                        disabled={
                          !dirty || locked || !draft.trim() || !title.trim()
                        }
                        onClick={() => void save()}
                      >
                        <Save /> Save
                      </Button>
                    </div>
                  </div>
                  {/* Five competing buttons become one control. The template
                      picker moves inside it, where it is a choice and not a gate. */}
                  <div className="tool-section">
                    <details className="shape-menu" ref={shapeMenu}>
                      <summary className="control shape-summary">
                        <Sparkles size={17} />
                        Shape your words
                        <ChevronDown size={15} className="shape-chevron" />
                      </summary>
                      <div className="shape-sheet">
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => void transform('clean')}
                        >
                          Clean up
                        </button>
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => void transform('rewrite')}
                        >
                          Rewrite
                        </button>
                        {clip.kind === 'reply' && (
                          <button
                            type="button"
                            disabled={locked || dirty}
                            onClick={() => void transform('reply')}
                          >
                            Draft reply
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={locked || dirty}
                          onClick={() => void transform('prompt')}
                        >
                          Turn into an AI prompt
                        </button>
                        <hr />
                        <div className="shape-template">
                          <TemplatePicker
                            value={templateId}
                            onChange={setTemplateId}
                            disabled={locked}
                          />
                          <Button
                            variant="outline"
                            className="control w-full mt-2"
                            disabled={locked || dirty || !templateId}
                            onClick={() =>
                              void transform('rewrite', templateId)
                            }
                          >
                            Apply template
                          </Button>
                        </div>
                      </div>
                    </details>
                    {writingFeedback && (
                      <Alert
                        className={`mt-3 flex items-center gap-3 ${writingFeedback.kind === 'error' ? 'error-banner' : ''}`}
                        variant={
                          writingFeedback.kind === 'error'
                            ? 'destructive'
                            : 'default'
                        }
                        role={
                          writingFeedback.kind === 'error' ? 'alert' : 'status'
                        }
                      >
                        {writingFeedback.kind === 'working' && (
                          <LoaderCircle
                            className="animate-spin shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <AlertDescription className="flex-1">
                          {writingFeedback.text}
                        </AlertDescription>
                        {writingFeedback.kind !== 'working' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Dismiss writing message"
                            onClick={() => setWritingFeedback(null)}
                          >
                            <X />
                          </Button>
                        )}
                      </Alert>
                    )}
                    <p className="subtle text-sm mt-3">
                      Review AI drafts before using them. Your source is always
                      kept.
                    </p>
                  </div>
                  {!adding ? (
                    <Button
                      variant="outline"
                      className="control w-full"
                      disabled={locked || dirty}
                      onClick={() => setAdding(true)}
                    >
                      <Plus /> Add more to this thought
                    </Button>
                  ) : (
                    <div className="add-panel">
                      <div className="section-line">
                        <h2>Keep your thought going</h2>
                        <Button
                          variant="ghost"
                          className="control"
                          disabled={locked}
                          onClick={() => {
                            if (addition) {
                              setError(
                                'Add your text first, or clear it before closing.',
                              );
                              return;
                            }
                            setAdding(false);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      <Recorder
                        target={{ clipId: clip.id }}
                        compact
                        ensureCloud={() => true}
                        onBusy={setRecording}
                        onTranscript={async (value, segmentId) => {
                          await change({
                            action: 'append',
                            content: value,
                            segmentId,
                          });
                          setNotice('Added as a new original segment.');
                          setAdding(false);
                        }}
                      />
                      <label className="field-label" htmlFor="addition">
                        Or add a few words
                      </label>
                      <Textarea
                        className="field"
                        id="addition"
                        value={addition}
                        onChange={(e) => setAddition(e.target.value)}
                        disabled={locked}
                        maxLength={20000}
                      />
                      <Button
                        className="control mt-3"
                        disabled={locked || !addition.trim()}
                        onClick={() =>
                          void action(async () => {
                            await change({
                              action: 'append',
                              content: addition,
                            });
                            setAddition('');
                            setAdding(false);
                            setNotice('Added to your thought.');
                          })
                        }
                      >
                        <Plus /> Add text
                      </Button>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="original">
                  <p className="subtle text-sm mb-4">
                    Your captured words, preserved in the order you added them.
                  </p>
                  {clip.segments.map((segment, i) => (
                    <div className="segment" key={segment.id}>
                      <span className="eyebrow">Segment {i + 1}</span>
                      <p className="preserve-text">{segment.text}</p>
                      {clip.segments.length > 1 && (
                        <Button
                          variant="ghost"
                          className="control mt-2"
                          disabled={locked || dirty}
                          onClick={() =>
                            void action(async () => {
                              await change({
                                action: 'without-segment',
                                segmentId: segment.id,
                              });
                              setTab('draft');
                              setNotice(
                                'Draft rebuilt from the other original segments. All source segments remain here.',
                              );
                            })
                          }
                        >
                          Draft without this segment
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="actions">
                    <Button
                      variant="outline"
                      className="control"
                      onClick={() => void copy(clip.original)}
                    >
                      <Copy /> Copy original
                    </Button>
                    <Button
                      variant="outline"
                      className="control"
                      disabled={
                        dirty || locked || clip.content === clip.original
                      }
                      onClick={() =>
                        void action(async () => {
                          await change({ action: 'restore-original' });
                          setTab('draft');
                        })
                      }
                    >
                      <Undo2 /> Restore original
                    </Button>
                  </div>
                  {clip.context && (
                    <div className="segment">
                      <span className="field-label">Incoming message</span>
                      <p className="preserve-text">{clip.context}</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="versions">
                  <p className="subtle text-sm mb-4">
                    Restoring creates another version. Nothing here is
                    overwritten.
                  </p>
                  {[...clip.versions].reverse().map((v, i) => (
                    <details className="version" key={v.id}>
                      <summary>
                        <span className="capitalize">
                          {v.kind} {i === 0 ? '· Current' : ''}
                        </span>
                        <time>{new Date(v.createdAt).toLocaleString()}</time>
                      </summary>
                      <p className="preserve-text">{v.text}</p>
                      <div className="actions">
                        <Button
                          className="control"
                          variant="outline"
                          onClick={() => void copy(v.text)}
                        >
                          <Copy /> Copy
                        </Button>
                        <Button
                          className="control"
                          variant="outline"
                          disabled={i === 0 || dirty || locked}
                          onClick={() =>
                            void action(async () => {
                              await change({
                                action: 'restore',
                                versionId: v.id,
                              });
                              setTab('draft');
                            })
                          }
                        >
                          <Undo2 /> Restore
                        </Button>
                      </div>
                    </details>
                  ))}
                </TabsContent>
              </Tabs>
              {busy && (
                <output className="subtle flex items-center gap-2">
                  <LoaderCircle className="animate-spin" size={16} /> Working…
                </output>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thought?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the thought and all its versions from Clipboard, including All and Pinned.
              Export anything you want to keep first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep thought</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white"
              onClick={() =>
                void action(async () => {
                  await api('clips/' + clip!.id, {
                    method: 'DELETE',
                    body: JSON.stringify({ revision: clip!.revision }),
                  });
                  setRemove(false);
                  onDelete(clip!.id);
                })
              }
            >
              Delete thought
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave unsaved words?</AlertDialogTitle>
            <AlertDialogDescription>
              Your saved thought is safe. The changes you haven’t saved will be
              discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscard(false);
                onClose();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={copyText !== null}
        onOpenChange={(v) => {
          if (!v) setCopyText(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Copy your words</DialogTitle>
          <DialogDescription>
            Clipboard access is unavailable here. Select and copy the text
            below.
          </DialogDescription>
          <Textarea
            aria-label="Text to copy"
            className="field"
            value={copyText ?? ''}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
