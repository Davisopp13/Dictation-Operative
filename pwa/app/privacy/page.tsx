import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
export default function Privacy() {
  return (
    <main className="privacy-page">
      <Link href="/" className="navigation-button">
        <ArrowLeft size={16} aria-hidden="true" /> Back to DO
      </Link>
      <h1>Your words, handled with care.</h1>
      <p>
        DO PWA V2 is a private voice workspace. Last updated September 11, 2026.
      </p>
      <h2>Your account</h2>
      <p>
        You can create an account with a username, email and password, or use
        Google when enabled. Passwords are stored as salted hashes. Sign-in
        sessions use HTTP-only cookies; session records include an IP address,
        browser information and an expiry time. Google supplies your account
        identifier, name, email and profile image. DO does not request access to
        your Gmail, Drive or Calendar. Email password recovery is not yet available.
      </p>
      <h2>Included AI</h2>
      <p>
        When included AI is enabled, DO uses a service connection stored only on
        the server. That key is never delivered to your browser or paired devices.
        Cloud processing still requires your consent. Per-account and overall
        daily request counts limit usage; attempts may count even when a provider
        cannot complete them. Allowances reset at midnight UTC. Device-to-device
        sharing of your own key is a separate, optional feature described below.
      </p>
      <h2>What is saved</h2>
      <p>
        Your signed-in account owns its thoughts, pasted messages, original
        segments, saved versions, pins, collections, tags, vocabulary,
        templates, and settings. These are stored in the site’s server database,
        rather than the system clipboard. Images you paste or upload to
        Clipboard are saved privately as PNG files in server object storage,
        with their names and dimensions in the database. You can download or
        delete them in Clipboard; text backups do not include images. Images are
        not sent to AI providers. The web app’s Groq API key is encrypted before storage
        and that server-stored copy is never returned to the browser. Optional
        account sync can deliver a separately shared key as described below.
      </p>
      <h2>Recording and AI</h2>
      <p>
        When you allow cloud processing, recording audio is sent through DO to
        Groq for transcription. Text and incoming messages are sent to Groq only
        when requested by a writing workflow, including automatic reply and
        prompt drafting. Included AI uses DO’s service connection and allowances;
        if you supply your own connection, your provider limits and charges apply. Review{' '}
        <a className="text-link" href="https://groq.com/privacy-policy/">
          Groq’s privacy policy
        </a>{' '}
        for its handling and retention of submitted data.
      </p>
      <p>
        DO keeps unfinished recordings and their intended destination in this
        device’s browser storage, including while offline. Audio and temporary
        transcripts are removed after successful library saving or when you
        discard them. They are not encrypted by DO at rest; protect access to
        your device. Clearing browser data, private browsing, or storage
        eviction can erase them. Download important recordings as a backup.
        Recordings stop after five minutes or when the page becomes hidden; a
        browser crash can lose the final chunk or leave an incomplete audio
        container.
      </p>
      <h2>You choose what leaves the workspace</h2>
      <p>
        Copy and Share happen only when you select them. DO does not monitor
        your device’s clipboard, type into other apps, or send messages
        automatically. Sync transfers happen only when you select Send or
        Receive in the PWA; the Mac app also offers an optional automatic mode.
      </p>
      <h2>Dictation Operative Sync</h2>
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
        dictation library is separate and follows the retention described above.
        Keep invitations private and approve only devices you recognize.
      </p>
      <h2>Account sync and shared Groq settings</h2>
      <p>
        Account sync connects approved devices to your signed-in identity.
        Each device has its own revocable authorization. An existing trusted
        device delivers the account encryption key through an encrypted pairing.
        Browser account access also requires sign-in to the matching account.
        Account clipboard items remain available to all trusted devices until
        replacement, expiry after two minutes, or removal of their source device.
        Viewing or copying an account item does not delete it for other devices.
      </p>
      <p>
        Groq settings and an optionally shared API key are encrypted on your
        device before account storage. The relay cannot decrypt them. Shared
        settings persist until replaced; publish preferences without a key to
        remove the key from the current shared record. Devices choose whether to
        apply that key. Native credentials live in Keychain. Browser account
        keys remain in account-scoped local site storage, accessible to trusted
        same-origin code. Selecting Use shared connection in web app decrypts
        the shared Groq key in the browser and sends it to DO’s existing server
        credential store for cloud processing; processing consent remains separate.
      </p>
      <p>
        Removing an account device blocks future account access and removes its
        shared clipboard. It does not erase keys or content already received,
        or revoke independent direct pairings. Remove those pairings separately
        and rotate an exposed Groq key at Groq. If every trusted device’s keys
        are lost, sign-in alone cannot recover encrypted account data.
      </p>
      <h2>Export and delete</h2>
      <p>
        Export the whole library as JSON from Library, or export individual
        thoughts as text. Delete a thought in its editor to remove the record
        and all versions from the active database. Provider retention and
        infrastructure backups follow their own policies. Disconnecting Groq
        removes the saved key but keeps your thoughts.
      </p>
      <h2>Connectivity</h2>
      <p>
        An internet connection is required for library access, recording
        transcription, and AI. The home-screen app caches icons and an offline
        capture screen, but never caches private API responses or transcript
        pages. Offline capture requires an initial online sign-in. Cloud
        transcription and writing still require connectivity and consent.
        Preferred spellings and selected template instructions are sent to Groq
        with the relevant request.
      </p>
      <h2>Contact</h2>
      <p>
        For account, support or privacy questions, contact{' '}
        <a className="text-link" href="mailto:davisopp@docodelab.com">
          davisopp@docodelab.com
        </a>.
      </p>
    </main>
  );
}
