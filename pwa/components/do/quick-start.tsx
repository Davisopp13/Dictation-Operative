'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  BookOpen,
  Check,
  Clipboard,
  Copy,
  Download,
  Layers,
  Mic,
  Monitor,
  Pin,
  Sparkles,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ThemeToggle } from './theme';
import { quickStart } from '@/lib/quick-start';

function GuideContent() {
  const icons = [Mic, Sparkles, Clipboard];
  return (
    <div className="quick-start">
      <header className="guide-stage">
        <div className="guide-brand">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={52}
            height={52}
            unoptimized
          />
          <span>
            DICTATION
            <br />
            OPERATIVE
          </span>
        </div>
        <p className="guide-kicker">START HERE · QUICK GUIDE</p>
        <h2>{quickStart.title}</h2>
        <p>{quickStart.subtitle}</p>
        <div className="guide-flow" aria-label="Capture, then Refine, then Use">
          <span>
            <Mic /> Capture
          </span>
          <ArrowRight />
          <span>
            <Sparkles /> Refine
          </span>
          <ArrowRight />
          <span>
            <Clipboard /> Use
          </span>
        </div>
      </header>

      <ol className="guide-steps">
        {quickStart.steps.map((step, index) => {
          const Icon = icons[index];
          return (
            <li key={step.title}>
              <div className="guide-step-heading">
                <span className="guide-step-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="guide-number">0{index + 1}</span>
              </div>
              <h3>{step.title}</h3>
              <p className="guide-caption">{step.caption}</p>
              <p>{step.body}</p>
              <div
                className="guide-snippet"
                aria-label={`${step.title} example`}
              >
                {index === 0 ? (
                  <>
                    <Mic aria-hidden="true" />
                    <span>
                      “The first draft is ready.
                      <br />
                      I’ll send it over today.”
                    </span>
                  </>
                ) : index === 1 ? (
                  <>
                    <Sparkles aria-hidden="true" />
                    <span>
                      The first draft is ready.
                      <br />
                      I’ll send it over today.
                    </span>
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" />
                    <span>
                      Copy <span aria-hidden="true">·</span> Share{' '}
                      <span aria-hidden="true">·</span>{' '}
                      <Pin size={14} aria-hidden="true" /> Pin
                    </span>
                  </>
                )}
              </div>
              <p className="guide-tip">{step.tip}</p>
            </li>
          );
        })}
      </ol>

      <section className="guide-example" aria-label="Try a project update">
        <div>
          <Layers aria-hidden="true" />
          <h3>Try it: three thoughts, one email.</h3>
        </div>
        <ol>
          <li>Record three project updates.</li>
          <li>Select and order them in Compose.</li>
          <li>Choose Email → Create draft.</li>
          <li>Review, copy, and send from your email app.</li>
        </ol>
      </section>

      <div className="guide-devices">
        <section>
          <h3>
            <Monitor aria-hidden="true" /> On your Mac
          </h3>
          <p>{quickStart.mac}</p>
          <p className="guide-tip">
            Requires the native Mac app, microphone and Accessibility
            permissions, and a downloaded speech model. If you changed your
            shortcut, use that instead.
          </p>
          <Link
            href="/mac"
            target="_blank"
            rel="noopener noreferrer"
            className="guide-text-link"
          >
            Mac setup guide <ArrowRight aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </section>
        <section>
          <h3>
            <ArrowLeftRight aria-hidden="true" /> Across devices
          </h3>
          <p>{quickStart.sync}</p>
          <p className="guide-tip">
            Choose a destination to Send clipboard or Receive latest for text
            and images. Keep the web app open and both devices online. Mac and
            web dictation histories stay separate.
          </p>
        </section>
      </div>
      <p className="guide-note">
        <Check aria-hidden="true" />
        <span>
          Before your first recording, allow microphone access and follow the
          voice &amp; AI setup prompts. Web transcription and AI tools need an
          internet connection.
        </span>
      </p>
    </div>
  );
}

function DownloadGuide() {
  return (
    <a
      className={`${buttonVariants({ variant: 'outline' })} control`}
      href="/docs/do-quick-start.png"
      download="DO-quick-start.png"
    >
      <Download aria-hidden="true" /> Download infographic{' '}
      <span className="guide-filetype">PNG</span>
    </a>
  );
}

export function QuickStartDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="guide-dialog">
        <div className="guide-dialog-heading">
          <DialogTitle>Help · Quick start</DialogTitle>
          <DialogDescription>
            Capture, refine, and use your first thought.
          </DialogDescription>
        </div>
        <GuideContent />
        <div className="guide-actions">
          <DownloadGuide />
          <Button className="control" onClick={() => onOpenChange(false)}>
            Back to workspace <ArrowRight aria-hidden="true" />
          </Button>
          <Link
            href="/help"
            target="_blank"
            rel="noopener noreferrer"
            className="guide-text-link"
          >
            Open full guide
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QuickStartPage() {
  return (
    <main className="guide-page">
      <nav className="guide-page-nav" aria-label="Guide navigation">
        <Link href="/" className="guide-text-link">
          <ArrowLeft aria-hidden="true" /> Workspace
        </Link>
        <ThemeToggle />
      </nav>
      <h1 className="guide-page-title">
        <BookOpen aria-hidden="true" /> Help · Quick start
      </h1>
      <GuideContent />
      <div className="guide-actions">
        <DownloadGuide />
        <Link href="/" className={`${buttonVariants()} control`}>
          Start capturing <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
