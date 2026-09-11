'use client';
import {
  Plus,
  Clipboard,
  Pencil,
  CornerUpLeft,
  Check,
  LoaderCircle,
  ArrowUpRight,
  Sparkles,
  Pin,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Recorder } from '@/components/do/recorder';
import { TemplatePicker } from './workspace-tools';
import type { ClipKind, ClipSummary } from '@/lib/domain';
import type { SettingsState } from '@/components/do/settings';
import type { ReactNode } from 'react';

type View = 'capture' | 'clipboard' | 'compose';

export type CaptureProps = {
  settingsLoaded: boolean;
  settings: SettingsState;
  setSettingsOpen: (open: boolean) => void;
  locked: boolean;
  busy: boolean;
  mode: ClipKind;
  setMode: (mode: ClipKind) => void;
  incoming: string;
  setIncoming: (value: string) => void;
  templateId: string;
  setTemplateId: (value: string) => void;
  text: string;
  setText: (value: string) => void;
  textOpen: boolean;
  setTextOpen: (open: boolean) => void;
  setError: (message: string) => void;
  setRecording: (recording: boolean) => void;
  createCapture: (content: string, id: string) => Promise<void>;
  nextCaptureId: () => string;
  resetCaptureId: () => void;
  run: (task: () => Promise<void>) => Promise<void>;
  paste: () => Promise<void>;
  recent: ClipSummary[];
  recentLoading: boolean;
  card: (item: ClipSummary, selectable?: boolean) => ReactNode;
  setView: (view: View) => void;
  setQuery: (query: string) => void;
};

/** Capture: the surface where nothing stands between you and the microphone. */
export function CaptureSurface({
  settingsLoaded,
  settings,
  setSettingsOpen,
  locked,
  busy,
  mode,
  setMode,
  incoming,
  setIncoming,
  templateId,
  setTemplateId,
  text,
  setText,
  textOpen,
  setTextOpen,
  setError,
  setRecording,
  createCapture,
  nextCaptureId,
  resetCaptureId,
  run,
  paste,
  recent,
  recentLoading,
  card,
  setView,
  setQuery,
}: CaptureProps) {
  return (
          <>
            {settingsLoaded && (!settings.connected || !settings.consent) && (
              <div className="panel connect-nudge-mobile">
                <p className="text-sm subtle">
                  One quick setup before your first recording.
                </p>
                <Button
                  variant="secondary"
                  className="control w-full mt-3"
                  onClick={() => setSettingsOpen(true)}
                >
                  Connect voice & AI <ArrowUpRight />
                </Button>
              </div>
            )}
          <div className="capture-grid">
            <div>
              <section className="panel record-panel">
                {/* Nothing stands between the reader and the microphone.
                    Reply still needs its incoming message first, so it is an
                    explicit choice below rather than a tab above. */}
                {mode === 'reply' && (
                  <div className="context-input">
                    <div className="section-line">
                      <label htmlFor="incoming" className="field-label">
                        What are you replying to?
                      </label>
                      <Button
                        variant="ghost"
                        className="control"
                        disabled={locked}
                        onClick={() => {
                          setMode('note');
                          setIncoming('');
                        }}
                      >
                        Cancel reply
                      </Button>
                    </div>
                    <Textarea
                      className="field"
                      id="incoming"
                      placeholder="Paste the message you received…"
                      value={incoming}
                      disabled={locked}
                      onChange={(e) => setIncoming(e.target.value)}
                      maxLength={10000}
                    />
                    <p className="subtle text-sm mt-2">
                      Then speak your reply points. We&rsquo;ll save the source and
                      draft a response.
                    </p>
                  </div>
                )}
                <Recorder
                  target={{
                    kind: mode,
                    context: mode === 'reply' ? incoming : '',
                    templateId,
                  }}
                  ensureCloud={() => {
                    if (text.trim()) {
                      setError(
                        'Save your typed thought first, then use Add More in its editor.',
                      );
                      return false;
                    }
                    if (mode === 'reply' && !incoming.trim()) {
                      setError('Paste the incoming message first.');
                      return false;
                    }
                    return true;
                  }}
                  onBusy={setRecording}
                  onTranscript={async (value, recordingId) => {
                    await createCapture(value, recordingId);
                  }}
                />
                <div className="capture-secondary">
                  <Button
                    className="control"
                    variant="outline"
                    disabled={locked}
                    onClick={() => {
                      setTextOpen(true);
                    }}
                  >
                    <Pencil /> Write instead
                  </Button>
                  {mode !== 'reply' && (
                    <Button
                      className="control"
                      variant="outline"
                      disabled={locked}
                      onClick={() => setMode('reply')}
                    >
                      <CornerUpLeft /> Reply to something
                    </Button>
                  )}
                  <Button
                    className="control"
                    variant="ghost"
                    disabled={locked}
                    onClick={() => void paste()}
                  >
                    <Clipboard /> Paste
                  </Button>
                </div>
                <details className="template-disclosure">
                  <summary>Use a voice template</summary>
                  <TemplatePicker
                    value={templateId}
                    onChange={setTemplateId}
                    disabled={locked}
                  />
                </details>
                {textOpen && (
                  <form
                    className="text-capture"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const id = nextCaptureId();
                      void run(() => createCapture(text, id));
                    }}
                  >
                    <label className="field-label" htmlFor="capture-text">
                      {mode === 'reply'
                        ? 'Your reply points'
                        : mode === 'prompt'
                          ? 'What do you want AI to do?'
                          : 'Your thought'}
                    </label>
                    <Textarea
                      className="field"
                      id="capture-text"
                      value={text}
                      disabled={locked}
                      onChange={(e) => {
                        setText(e.target.value);
                        resetCaptureId();
                      }}
                      placeholder="Let it out. You can shape it later."
                      maxLength={20000}
                    />
                    <div className="actions">
                      <Button
                        className="control"
                        type="submit"
                        disabled={
                          locked ||
                          !text.trim() ||
                          (mode === 'reply' && !incoming.trim())
                        }
                      >
                        {busy ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Check />
                        )}{' '}
                        Save{' '}
                        {mode === 'note'
                          ? 'thought'
                          : mode === 'reply'
                            ? 'reply points'
                            : 'prompt idea'}
                      </Button>
                      <span className="subtle text-sm">
                        Original words are preserved.
                      </span>
                    </div>
                  </form>
                )}
              </section>
              <div className="section-line mt-8">
                <h2>Recent thoughts</h2>
                <Button
                  variant="ghost"
                  className="control"
                  disabled={locked}
                  onClick={() => {
                    setView('clipboard');
                    setQuery('');
                  }}
                >
                  View Clipboard <ArrowUpRight />
                </Button>
              </div>
              {recentLoading ? (
                <div className="thought-list" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <div className="thought-card" key={i}>
                      <div className="thought-main">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="mt-3 h-4 w-2/3" />
                        <Skeleton className="mt-2 h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recent.length ? (
                <div className="thought-list">
                  {recent.map((item) => card(item))}
                </div>
              ) : (
                <Empty className="empty">
                  <EmptyDescription>
                    A little space for your next big idea.
                    <br />
                    Your first capture will appear here.
                  </EmptyDescription>
                </Empty>
              )}
            </div>
            <aside className="panel">
              <div className="section-line">
                <h2>Room to think</h2>
                <Sparkles size={19} color="#245ce5" />
              </div>
              <div className="feature-row">
                <Plus />
                <div>
                  <strong>Add to a thought</strong>
                  <p className="subtle">
                    Keep talking later. Your new words stay with the original.
                  </p>
                </div>
              </div>
              <div className="feature-row">
                <Pin />
                <div>
                  <strong>Keep the good bits</strong>
                  <p className="subtle">
                    Find every saved thought in Clipboard. Pin your favorites.
                  </p>
                </div>
              </div>
              <div className="feature-row">
                <Layers />
                <div>
                  <strong>Make something of it</strong>
                  <p className="subtle">
                    Turn a few clips into an email, an update, or a clear next
                    step.
                  </p>
                </div>
              </div>
              {settingsLoaded && (!settings.connected || !settings.consent) && (
                <div className="connect-nudge">
                  <p className="text-sm subtle">
                    One quick setup before your first recording.
                  </p>
                  <Button
                    variant="secondary"
                    className="control w-full mt-3"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Connect voice & AI <ArrowUpRight />
                  </Button>
                </div>
              )}
            </aside>
          </div>
          </>
  );
}
