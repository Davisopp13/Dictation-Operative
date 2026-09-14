import Link from 'next/link';
import { ArrowLeft, ArrowRight, Download, Keyboard, Monitor } from 'lucide-react';
import { getUser, signInPath } from '@/app/auth';
import { SignedOut } from '@/app/signed-out';
import { WINDOWS_VERSION } from '@/lib/windows-release';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Windows setup — DO' };

export default async function WindowsSetup() {
  if (!(await getUser())) return <SignedOut signInPath={signInPath('/windows')} />;
  return (
    <main className="windows-setup">
      <Link href="/" className="navigation-button">
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Back to DO</span>
      </Link>
      <header className="windows-setup-header">
        <span className="windows-setup-eyebrow"><Monitor size={18} /> Windows setup</span>
        <h1>Try Win + Alt on your laptop</h1>
        <p>This small Windows app checks the shortcut and inserts sample text. Voice recording and Windows Sync are still to come.</p>
      </header>

      <section className="windows-setup-step" aria-labelledby="windows-download-title">
        <span className="windows-step-number" aria-hidden="true">1</span>
        <div>
          <h2 id="windows-download-title">Download the test app</h2>
          <p>On your Windows laptop, choose the download for its processor.</p>
          <a className="windows-download-button" href="/api/windows-downloads/x64" download>
            <Download size={20} /> Download for Windows
          </a>
          <p className="subtle text-sm">Intel / AMD · 50 MB · Version {WINDOWS_VERSION}</p>
          <details className="windows-help">
            <summary>Have an ARM laptop, or unsure which to choose?</summary>
            <p>Open Windows Settings → System → About and look for <strong>System type</strong>. Choose the main download for an x64-based processor, or the ARM download for an ARM-based processor.</p>
            <a className="navigation-button" href="/api/windows-downloads/arm64" download><Download size={16} aria-hidden="true" /> Download for Windows ARM · 48 MB</a>
          </details>
        </div>
      </section>

      <section className="windows-setup-step" aria-labelledby="windows-open-title">
        <span className="windows-step-number" aria-hidden="true">2</span>
        <div>
          <h2 id="windows-open-title">Extract and open</h2>
          <p>Open your Downloads folder. Right-click the ZIP and choose <strong>Extract All</strong>. In the extracted folder, open <strong className="windows-filename">DO.Windows.HotkeyProbe.exe</strong>.</p>
          <p>Open it normally. It does not request administrator rights or a separate runtime installation.</p>
          <details className="windows-help">
            <summary>Windows or your company blocks the app?</summary>
            <p>This test app is unsigned. Note the exact message and use your IT approval process if it is blocked. Do not change security settings to get around it.</p>
          </details>
        </div>
      </section>

      <section className="windows-setup-step" aria-labelledby="windows-test-title">
        <span className="windows-step-number" aria-hidden="true">3</span>
        <div>
          <h2 id="windows-test-title">Test in a blank Notepad document</h2>
          <ol className="windows-test-instructions">
            <li>In the test app, leave <strong>Also insert the sample text</strong> unchecked. Choose <strong>Win + Alt</strong> and click <strong>Enable hotkey</strong>.</li>
            <li>Click inside a blank Notepad document. Press <kbd>Win</kbd> + <kbd>Alt</kbd>, then release both within two seconds.</li>
            <li>Return to the test app and look for <strong>PASS: Windows delivered the shortcut.</strong></li>
            <li>Disable the hotkey, check <strong>Also insert the sample text</strong>, and enable it again. Return to Notepad and repeat the shortcut.</li>
          </ol>
          <div className="windows-sample"><Keyboard size={20} aria-hidden="true" /><span>DO Windows test — café ✓</span></div>
          <p className="subtle text-sm">The sample should appear once. The shortcut turns off after the insertion attempt. Adding another key cancels DO’s trigger.</p>
          <fieldset className="windows-test-checklist">
            <legend>Check each result after it works</legend>
            <label><input type="checkbox" /> The Windows test app opened.</label>
            <label><input type="checkbox" /> The Win + Alt shortcut was detected.</label>
            <label><input type="checkbox" /> The exact sample appeared once in Notepad.</label>
          </fieldset>
          <p>Choose <strong>Save test report…</strong> in the Windows app to keep your results. Note any unexpected Start menu or other menu opening.</p>
        </div>
      </section>

      <aside className="windows-setup-note">
        <h2>Already installed DO as a web app?</h2>
        <p>Keep using it for your Library, recording, and writing. This Windows test opens separately; installing the web app does not install it automatically.</p>
        <Link href="/" className="navigation-button"><span>Return to your workspace</span><ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>
    </main>
  );
}
