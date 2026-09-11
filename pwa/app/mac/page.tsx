import Link from 'next/link';
import { ArrowLeft, ArrowRight, Download, Keyboard, Laptop } from 'lucide-react';
import { getUser, signInPath } from '@/app/auth';
import { SignedOut } from '@/app/signed-out';
import { MAC_VERSION, macRelease } from '@/lib/mac-release';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mac setup — DO' };

export default async function MacSetup() {
  if (!(await getUser())) return <SignedOut signInPath={signInPath('/mac')} />;
  return (
    <main className="windows-setup">
      <Link href="/" className="navigation-button">
        <ArrowLeft size={16} aria-hidden="true" /><span>Back to DO</span>
      </Link>
      <header className="windows-setup-header">
        <span className="windows-setup-eyebrow"><Laptop size={18} aria-hidden="true" /> Mac setup</span>
        <h1>Dictate anywhere on your Mac</h1>
        <p>Add the DO Mac app for a global keyboard shortcut, on-device transcription, text insertion into other apps, and clipboard Sync.</p>
        <p className="subtle">The web app starts your download. Finish installation on your Mac and approve its permissions when prompted.</p>
      </header>

      <section className="windows-setup-step" aria-labelledby="mac-download-title">
        <span className="windows-step-number" aria-hidden="true">1</span>
        <div>
          <h2 id="mac-download-title">Download DO for Mac</h2>
          <p>For an <strong>Apple Silicon Mac</strong> running <strong>macOS 14 Sonoma or later</strong>.</p>
          <a className="windows-download-button" href="/api/mac-downloads/arm64" download>
            <Download size={20} aria-hidden="true" /> Download for Mac
          </a>
          <p className="subtle text-sm">{(macRelease.size / 1_000_000).toFixed(1)} MB · {MAC_VERSION} · Signed · Apple-notarized</p>
          <p className="subtle text-sm">Already using a newer Dictation build? Keep that version. This download is the earlier beta with paired clipboard Sync.</p>
          <details className="windows-help">
            <summary>Check your Mac or an existing installation</summary>
            <p>Choose Apple menu → <strong>About This Mac</strong>. Look for an Apple M-series chip and macOS 14 or later. This download does not support Intel Macs.</p>
            <p>If you already have a newer Dictation build, keep it. This beta uses manual downloads for updates and does not include the newer account device directory or shared Groq settings.</p>
          </details>
        </div>
      </section>

      <section className="windows-setup-step" aria-labelledby="mac-install-title">
        <span className="windows-step-number" aria-hidden="true">2</span>
        <div>
          <h2 id="mac-install-title">Move to Applications and open</h2>
          <p>Open the downloaded <strong className="windows-filename">{macRelease.filename}</strong>. Drag <strong>Dictation</strong> onto <strong>Applications</strong>, then open Dictation from your Applications folder.</p>
          <p>If Dictation is already running, quit it from its menu bar menu before replacing it. The app appears as a microphone in the menu bar, with no Dock icon.</p>
          <details className="windows-help">
            <summary>macOS or your organization blocks installation?</summary>
            <p>This installer is signed and notarized. If it is blocked, keep the exact message for troubleshooting or contact your IT team. You do not need to disable Gatekeeper.</p>
          </details>
        </div>
      </section>

      <section className="windows-setup-step" aria-labelledby="mac-dictation-title">
        <span className="windows-step-number" aria-hidden="true">3</span>
        <div>
          <h2 id="mac-dictation-title">Set up your first dictation</h2>
          <ol className="windows-test-instructions">
            <li>Follow onboarding to allow <strong>Microphone</strong> access for recording.</li>
            <li>Allow <strong>Accessibility</strong> in System Settings → Privacy &amp; Security → Accessibility so Dictation can insert text into your apps.</li>
            <li>Download a speech model in the Mac app. <strong>base.en</strong> is a small English model to start with.</li>
            <li>Click inside a blank TextEdit document. Tap <kbd>Control</kbd> + <kbd>Option</kbd>, speak, then tap again to insert your words.</li>
          </ol>
          <div className="windows-sample"><Keyboard size={20} aria-hidden="true" /><span>Control + Option · Tap to toggle, or hold to talk</span></div>
          <p className="subtle text-sm">After the model downloads, transcription runs on your Mac. AI cleanup is optional and has its own provider settings in the Mac app.</p>
        </div>
      </section>

      <section className="windows-setup-step" aria-labelledby="mac-sync-title">
        <span className="windows-step-number" aria-hidden="true">4</span>
        <div>
          <h2 id="mac-sync-title">Connect clipboard Sync</h2>
          <p>Open <strong>Settings → Sync</strong> from the Mac menu bar app. In this workspace, open <strong>Sync devices</strong>. Create a pairing code on one, enter it on the other, compare the confirmation codes, and approve the pairing.</p>
          <p>Select your paired device to <strong>Send clipboard</strong> or <strong>Receive latest</strong>. Keep the web app open for transfers. Clipboard Sync does not need a speech model or an AI key.</p>
          <p className="subtle text-sm">Pairing connects clipboard transfers; the Mac and web dictation histories remain separate. Automatic Mac clipboard sharing is optional and off by default.</p>
        </div>
      </section>

      <aside className="windows-setup-note">
        <h2>Your web workspace stays with you</h2>
        <p>Keep using the PWA for saved text, images, and writing. The Mac app adds dictation across your desktop. Installing the PWA alone does not enable Mac shortcuts or grant native permissions.</p>
        <Link href="/" className="navigation-button"><span>Return to your workspace</span><ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>
    </main>
  );
}
