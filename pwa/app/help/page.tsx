import type { Metadata } from 'next';
import { QuickStartPage } from '@/components/do/quick-start';

export const metadata: Metadata = {
  title: 'Quick start — Catchall Desk',
  description:
    'Save text, images, and documents on one device and use them on another. A quick guide to Clipboard, Documents, and device Sync.',
};

export default function HelpPage() {
  return <QuickStartPage />;
}
