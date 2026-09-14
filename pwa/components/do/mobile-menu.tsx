'use client';
import {
  Settings,
  Smartphone,
  SlidersHorizontal,
  ArrowLeftRight,
  MoreHorizontal,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useState } from 'react';
import { ThemeToggle } from './theme';

export function MobileMenu({
  locked,
  installed,
  onTools,
  onSync,
  onSettings,
  onInstall,
  onHelp,
}: {
  locked: boolean;
  installed: boolean;
  onTools: () => void;
  onSync: () => void;
  onSettings: () => void;
  onInstall: () => void;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="mobile-header-actions">
      <ThemeToggle />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              className="icon-control"
              aria-label="Open workspace menu"
            />
          }
        >
          <MoreHorizontal />
        </SheetTrigger>
        <SheetContent side="bottom" className="mobile-menu-sheet">
          <SheetHeader>
            <SheetTitle>Workspace</SheetTitle>
            <SheetDescription>
              Settings and tools for your workspace.
            </SheetDescription>
          </SheetHeader>
          <div className="mobile-menu-items">
            <Button variant="ghost" disabled={locked} onClick={() => choose(onHelp)}>
              <BookOpen /> Help · Quick start
            </Button>
            <Button variant="ghost" onClick={() => choose(onSettings)}>
              <Settings /> Settings
            </Button>
            <Button variant="ghost" onClick={() => choose(onSync)}>
              <ArrowLeftRight /> Sync devices
            </Button>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => choose(onTools)}
            >
              <SlidersHorizontal /> Workspace tools
            </Button>
            {!installed && (
              <Button variant="ghost" onClick={() => choose(onInstall)}>
                <Smartphone /> Install DO
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
