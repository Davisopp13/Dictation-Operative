import type { Metadata } from 'next';
import { QuickStartPage } from '@/components/do/quick-start';

export const metadata: Metadata = {
  title: 'Quick start — Dictation Operative',
  description:
    'Learn to capture, refine, and use your thoughts with DO. A quick visual guide to the voice workspace, Mac dictation, and device Sync.',
};

export default function HelpPage() {
  return <QuickStartPage />;
}
