import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
export const metadata = { title: 'Privacy & storage — Catch-all Desk' };
export default function Privacy() {
  return (
    <main className="privacy-page">
      <Link href="/" className="navigation-button">
        <ArrowLeft size={16} aria-hidden="true" /> Back to Catch-all Desk
      </Link>
      <h1>Your items, handled with care.</h1>
      <p>
        Catch-all Desk is a private workspace for moving text, images, and
        documents between your devices. It was previously called Dictation
        Operative. Last updated November 24, 2026.
      </p>
      <h2>Your account</h2>
      <p>
        You can create an account with a username, email and password, or use
        Google when enabled. Passwords are stored as salted hashes. Sign-in
        sessions use HTTP-only cookies; session records include an IP address,
        browser information and an expiry time. Google supplies your account
        identifier, name, email and profile image. Catch-all Desk does not
        request access to your Gmail, Drive or Calendar. Email password recovery
        is not yet available.
      </p>
      <h2>What is saved</h2>
      <p>
        Your signed-in account owns its saved text, original segments, saved
        versions, pins, collections, tags, and settings. These are stored in the
        site’s server database, rather than the system clipboard. Images you
        paste or upload to Clipboard are saved privately as PNG files in server
        object storage, with their names and dimensions in the database. You can
        download or delete them in Clipboard; text backups do not include
        images. Saved items are readable by the Catch-all Desk server so they can
        be shown on your other signed-in devices.
      </p>
      <h2>Documents</h2>
      <p>
        Documents saves only files and Google Docs/Sheets links you explicitly
        add. Files use private server object storage and account-owned database
        records. They are readable by the Catch-all Desk server; unlike device
        Sync transfers, they are not end-to-end encrypted. Documents stay until
        explicit deletion, including unpinned items. Daily Clipboard cleanup
        does not apply. File deletion retries after temporary storage failures.
        Abandoned upload reservations expire; they do not become saved files.
        Limits are 50 MB per file, 2 GB per account, and 500 items. Pending
        uploads and file deletions count toward the storage limit.
      </p>
      <p>
        Google links save shortcuts, without reading, copying, or changing the
        original document. Google’s existing permissions determine who can open
        it. Files are downloaded separately and excluded from text JSON backups.
        Access requires internet and the same signed-in account on each device.
      </p>
      <h2>Daily Clipboard cleanup</h2>
      <p>
        Daily cleanup is optional and off by default. When enabled in Settings,
        a server job runs once a day and permanently removes unpinned Clipboard
        text and images older than 24 hours, even when the app is closed. Pinned
        items stay until you delete them. This setting applies to your account
        across devices. Earlier dictation history, imported text, and text saved
        before this feature are preserved. Image file deletion retries after
        temporary storage failures. Infrastructure backups follow their own
        retention policies.
      </p>
      <h2>Retired recording and AI features</h2>
      <p>
        Recording, transcription, and AI writing tools have been removed. The
        app no longer sends audio or text to an AI provider. Text you dictated
        or rewrote earlier remains in Clipboard as ordinary saved text, with its
        originals and versions.
      </p>
      <p>
        Some data from those features is still stored and is no longer used: an
        encrypted Groq API key if you connected one, your cloud-processing
        choice, preferred spellings, and writing templates. Contact us if you
        want any of it deleted. If you supplied your own Groq key, you can also
        revoke it at Groq.
      </p>
      <p>
        Unfinished recordings made in this browser before the change stay in
        this device’s browser storage, with any transcript that was already
        produced. When they exist, the workspace offers to download the audio,
        save the transcript as text, or remove them. They are not encrypted by
        Catch-all Desk at rest; protect access to your device. Clearing browser
        data, private browsing, or storage eviction can erase them.
      </p>
      <h2>You choose what leaves the workspace</h2>
      <p>
        Copy, Share, and Paste from clipboard happen only when you select them.
        Catch-all Desk does not monitor your device’s clipboard, type into other
        apps, or send messages automatically. Sync transfers happen only when
        you select Send or Receive in the web app; the earlier Mac app also
        offers an optional automatic mode.
      </p>
      <h2>Device Sync</h2>
      <p>
        Paired devices encrypt text and PNG images end to end before transfer. A
        separate Cloudflare relay carries encrypted bytes over the internet.
        Active transfers expire after two minutes and are deleted after receipt,
        replacement, or removal of device trust. Interrupted uploads expire too.
        Infrastructure backups may retain encrypted bytes under the provider’s
        retention policy. The relay sees device names, pairing status, timing,
        content type, and encrypted size, but has no content decryption key.
        Clipboard contents are never intentionally logged or sent to analytics.
      </p>
      <p>
        Pairing keys are stored in this browser’s local site storage, separately
        for each signed-in account, and in macOS Keychain on the Mac app.
        Removing a trusted device revokes both directions. Clearing browser data
        loses its pairing keys; remove that browser from its paired device and
        pair again. Sync itself keeps no permanent clipboard history. Your saved
        Clipboard is separate and follows the retention described above. Keep
        invitations private and approve only devices you recognize.
      </p>
      <h2>Account sync</h2>
      <p>
        Account sync connects approved devices to your signed-in identity. Each
        device has its own revocable authorization. An existing trusted device
        delivers the account encryption key through an encrypted pairing.
        Browser account access also requires sign-in to the matching account.
        Account clipboard items remain available to all trusted devices until
        replacement, expiry after two minutes, or removal of their source
        device. Viewing or copying an account item does not delete it for other
        devices.
      </p>
      <p>
        The earlier Mac app can still publish encrypted Groq settings to your
        account’s devices. The relay cannot decrypt them, and the web app no
        longer reads or applies them. Native credentials live in Keychain.
        Browser account keys remain in account-scoped local site storage,
        accessible to trusted same-origin code.
      </p>
      <p>
        Removing an account device blocks future account access and removes its
        shared clipboard. It does not erase keys or content already received,
        or revoke independent direct pairings. Remove those pairings separately.
        If every trusted device’s keys are lost, sign-in alone cannot recover
        encrypted account data.
      </p>
      <h2>Export and delete</h2>
      <p>
        Export all saved text as JSON from Clipboard, or export a single item
        as text from its editor. Delete saved text in its editor or from its
        card to remove the record and all versions from the active database.
        Delete images and documents from their own lists. Infrastructure
        backups follow their own policies.
      </p>
      <p>
        To delete your account, open Settings → Account sign-in and choose
        Delete my account. You are asked to sign in again first. Deletion
        removes your saved text, images, documents, settings, and sign-in, and
        signs out every device. Stored files are removed promptly, and at the
        latest by the next daily cleanup. The encrypted device directory used
        by account sync, which holds device names and no readable content, is
        not yet removed automatically; contact us to have it deleted.
      </p>
      <h2>Connectivity</h2>
      <p>
        An internet connection is required to load, save, and sync. The
        home-screen app caches its icons and a simple offline notice, and never
        caches private API responses or your saved items.
      </p>
      <h2>Contact</h2>
      <p>
        For account, support or privacy questions, contact{' '}
        <a className="text-link" href="mailto:davisopp@docodelab.com">
          davisopp@docodelab.com
        </a>
        .
      </p>
    </main>
  );
}
