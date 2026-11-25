'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  BookOpen,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Pin,
  Search,
  Share2,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ThemeToggle } from './theme';
import { LogoOnBrand } from './wordmark';
import { quickStart } from '@/lib/quick-start';

function GuideContent() {
  const icons = [ClipboardPaste, Pin, Share2];
  return (
    <div className="quick-start">
      <header className="guide-stage">
        <div className="guide-brand">
          <LogoOnBrand />
        </div>
        <p className="guide-kicker">START HERE · QUICK GUIDE</p>
        <h2>{quickStart.title}</h2>
        <p>{quickStart.subtitle}</p>
        <div
          className="guide-flow"
          aria-label="Bring it in, then keep it handy, then take it out"
        >
          <span>
            <ClipboardPaste /> In
          </span>
          <ArrowRight />
          <span>
            <Pin /> Keep
          </span>
          <ArrowRight />
          <span>
            <Share2 /> Out
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
                    <ClipboardPaste aria-hidden="true" />
                    <span>Text · Images · Files · Google links</span>
                  </>
                ) : index === 1 ? (
                  <>
                    <Search aria-hidden="true" />
                    <span>
                      <Pin size={14} aria-hidden="true" /> Pin{' '}
                      <span aria-hidden="true">·</span> Search{' '}
                      <span aria-hidden="true">·</span> Filter
                    </span>
                  </>
                ) : (
                  <>
                    <Copy aria-hidden="true" />
                    <span>
                      Copy <span aria-hidden="true">·</span> Share{' '}
                      <span aria-hidden="true">·</span>{' '}
                      <Download size={14} aria-hidden="true" /> Download
                    </span>
                  </>
                )}
              </div>
              <p className="guide-tip">{step.tip}</p>
            </li>
          );
        })}
      </ol>

      <div className="guide-devices">
        <section>
          <h3>
            <ArrowLeftRight aria-hidden="true" /> Direct device handoff
          </h3>
          <p>{quickStart.sync}</p>
          <p className="guide-tip">
            Handoff transfers are encrypted between your paired devices and
            expire after two minutes. Keep the app open and both devices
            online.
          </p>
        </section>
      </div>
      <p className="guide-note">
        <Check aria-hidden="true" />
        <span>
          Your saved Clipboard and Documents are private to your signed-in
          account and need an internet connection.
        </span>
      </p>
    </div>
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
            Save something on one device and use it on another.
          </DialogDescription>
        </div>
        <GuideContent />
        <div className="guide-actions">
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
        <Link href="/" className={`${buttonVariants()} control`}>
          Open workspace <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
