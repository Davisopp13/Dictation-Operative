# Dictation Operative — hands-on testing guide

Prepared September 7, 2026, for the published PWA V2, native Mac app, and Dictation Operative Sync. This is a test plan, not a claim that these manual checks have passed.

**Start here:** [Open the published workspace](https://do-voice-workspace.davisopp.workers.dev/). Test the published site rather than localhost. Use `/Applications/Dictation.app` for Mac tests.

## How to use this guide

Run the quick pass first, then work through the detailed sections. Allow roughly 20–30 minutes for the quick pass and several sessions for the full guide. Record **Pass, Fail, Blocked, or N/A** beside each test ID. For a failure, use the issue template at the end. A blocked test is not a pass.

Repeat the PWA essentials on both your Mac browser and your iPhone’s home-screen app. Repeat Sync in both directions. Mark tests requiring unavailable devices, permissions, provider accounts, or a future update as Blocked/N/A with the reason.

| Test session | Your notes |
| --- | --- |
| Date / tester | |
| Mac model and macOS version | |
| Browser and version | |
| iPhone/iPad model and OS version | |
| PWA opened in browser or from home screen | |
| Native app version/build from About Dictation | |
| Same Wi-Fi or separate networks | |
| Connected AI provider / selected Mac model | |

### Prepare once

- Use fictional notes prefixed **TEST —** so they are easy to find and remove.
- Export your existing PWA library and workspace tools before testing imports or deletion. These are **two separate exports**. Do not clear browser storage while unfinished audio is present.
- Have a Mac, an iPhone if available, and an empty Notes or TextEdit document ready. Use an empty editor tab for insertion tests; do not submit messages or execute terminal commands.
- Connect Groq and enable **Allow cloud processing** in PWA Settings for transcription and AI tests. Typed notes and clipboard Sync do not require Groq. Actual AI tests use your provider allowance.
- For Mac dictation, download a model and verify Microphone and Accessibility permissions. Start with AI cleanup off, then test it separately.
- For Sync, keep both devices awake and online. Start with automatic syncing off. Use only test clipboard content while automatic syncing is enabled.
- Keep a screenshot and a PNG with visible transparency available. The repository fixture [transparency.png](../macos/SyncValidation/transparency.png) is 64 × 32 pixels with transparent, semitransparent, and opaque bands. Copy its **image content**, not its file in Finder, for the image tests.

### Reusable test material

**Dictation:** “Testing one two three. Please send the project update to Morgan by Friday at three PM. The budget is forty-two dollars and fifty cents. Dictation Operative is ready for review.”

**Messy wording:** “Um, so I think we should, like, finish the draft on Friday, and then review it Monday.”

**Incoming message:** “Can you share the project status and tell me what you need from me?”

**Reply points:** “The draft is done. Testing starts tomorrow. I need you to approve the blue icon. No launch date is agreed yet.”

**Prompt idea:** “Help me plan a five-day trip to Boston with two adults. We enjoy museums and walking. Present a daily itinerary. I haven’t set a budget.”

**Exact clipboard text:** `TEST — café 🎙️ — line one` followed by a new line and `Line two: $42.50 / Friday 3:00 PM`.

## 1. Quick pass after every update

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| Q01 | Open the published PWA and visit Capture, Library, and Compose. | All load; navigation and controls work without a blank screen. | |
| Q02 | Record the dictation sample, tap to stop, then reopen the saved thought. | One thought appears with recognizable wording, names/numbers worth reviewing, and preserved original text. | |
| Q03 | Edit its title to `TEST — Quick pass`, save, reload, then copy and paste into Notes. | Title and edits persist; pasted text matches the current draft. | |
| Q04 | Run Clean up and restore the original from the editor. | Each result is recoverable; the original remains unchanged. | |
| Q05 | Pin the thought, assign a collection/tag, and find it with Library filters. | All filters and the pinned view find the expected item. | |
| Q06 | Record offline after an initial online visit; reconnect and recover it. | One recoverable thought saves, without duplicate notes. See R01–R03. | |
| Q07 | In TextEdit, use Mac tap-to-start/tap-to-stop, then hold-to-talk. | Each inserts once; the mic stops; no stuck recording indicator remains. | |
| Q08 | Quit and reopen the installed Mac app, then dictate again. | It works without repeating the setup flow when prerequisites remain granted. | |
| Q09 | Pair Mac and PWA; send the exact clipboard text each way and paste. | Both directions preserve text, Unicode, and line breaks. | |
| Q10 | Send an actual PNG each way, receive, and paste into an image-capable app. | An image pastes, rather than a URL or path; transparency is retained where the destination displays it. | |

## 2. PWA access, installation, and settings

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| A01 | Open the published link while signed into your authorized account. | Your workspace loads. A separate unauthorized/private session does not reveal your library. Do not change site sharing to run this test. | |
| A02 | Use the app’s installation guidance to add it to your phone’s home screen; launch it there. | The correct icon opens a usable workspace. Sign in again if that browser context requires it. | |
| A03 | Open Settings; verify Groq connected state. Close and reopen Settings. | State persists, and the saved secret is not displayed back in the API-key field. | |
| A04 | Turn off Allow cloud processing, try an AI action, then save a typed Note. Re-enable consent. | AI is blocked with a useful explanation; typed capture still works. Retained audio is available for later recovery if you recorded. | |
| A05 | Try a deliberately invalid provider key only if you can restore your valid key. | The app reports the problem and never claims a successful connection. Check the resulting connection state and restore it before continuing. | |
| A06 | Disconnect Groq, reload, then reconnect with your key. | Connection status updates; saved thoughts remain available; AI works after reconnection and consent. | |
| A07 | Deny microphone permission for this site, attempt recording, then allow it using browser website settings. | Denial produces guidance; retry works after approval without losing existing notes. This is browser permission, separate from the Mac app’s permissions. | |
| A08 | Open the privacy information from Settings. | It loads and explains cloud processing and storage consistently with the app. | |

## 3. PWA capture and writing

Judge AI outputs by meaning, omissions, and invented facts—not an exact sentence match. Note recognition mistakes separately from application failures.

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| C01 | Select Note, tap record, speak for 15–30 seconds, tap stop. | Timer and processing status make sense; one original thought saves; microphone use ends. | |
| C02 | Repeat with a quiet sentence, natural pauses, and the names/numbers sample. | Useful speech is retained; silence does not produce a long invented passage. Record recognition quality. | |
| C03 | Choose Write a thought, enter two paragraphs and an emoji, save, then reload. | Paragraphs and characters persist exactly. Empty text cannot create a blank thought. | |
| C04 | Copy test text from Notes and choose Paste. If blocked, paste manually into the text field. | The explicit action brings in the expected text; the fallback works or explains the permission limitation. Nothing saves before your save action. | |
| C05 | Leave unsaved typed text in Capture and try recording. | The app asks you to save it first and use Add More; the typed text is not silently replaced. | |
| C06 | Choose Reply, enter the incoming message and reply points, and create the draft. Repeat once with spoken points. | A reply is drafted; Original retains the incoming message and your points. No invented launch commitment or automatic message sending occurs. | |
| C07 | Try Reply without an incoming message. | A clear prompt asks for the missing message, without creating an unusable reply. | |
| C08 | Choose AI prompt and use the prompt sample. | The draft organizes Goal, Context, Constraints, and Output; missing budget information is not fabricated. Source wording is preserved. | |
| C09 | Record close to five minutes. | Recording stops at the limit, gives a result or recoverable error, and releases the microphone. | |
| C10 | On iPhone, record briefly, then lock the screen or switch apps. Return. | Capture stops rather than promising background recording. Saved or unfinished audio is accounted for; document any lost words or recovery error. | |

## 4. PWA editor, history, and internal clipboard

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| E01 | Rename and edit a thought, choose Save, close/reopen, and reload the page. | The saved title and draft persist. The original is unchanged. | |
| E02 | Make unsaved edits to title and text; choose Undo edits. | The last saved values return. | |
| E03 | Edit without saving, then try closing the editor or switching work. | You are protected from silent loss or clearly warned. Record any path that discards text without warning. | |
| E04 | Run Clean up on the messy sample, then Rewrite. | Clean up improves filler/punctuation; Rewrite reshapes wording without changing facts. Both save new versions. | |
| E05 | Use the editor’s AI prompt action and, on a reply thought, Draft reply. | Each creates the requested form while preserving sources and earlier versions. | |
| E06 | Add more to this thought using a recording, then Add text. | Both append to the same thought, in order, as separate original segments. | |
| E07 | In Original, choose Draft without this segment. | Only the current draft is rebuilt from other original segments. The omitted segment remains visible in Original. | |
| E08 | Choose Restore original; then restore an older entry from Versions. | The selected wording becomes current, with a new restoration version; prior versions remain available. | |
| E09 | Copy current draft, Copy original, and Copy an older version, pasting each into Notes. | Each action copies the exact selected source. | |
| E10 | Share a thought, then cancel the share sheet. Export text and open the downloaded file. | Supported devices offer sharing; unsupported ones offer the app’s fallback. Cancel is harmless. The text export matches the draft. | |
| E11 | Pin/unpin in the editor and Library. Inspect the pinned internal clipboard. | The pinned view follows the saved state. Pinning does not mean the operating system clipboard was changed. | |
| E12 | Search for a title, a word in a draft, and a term that does not exist. Clear search. | Results and empty state are sensible; clearing restores the list. Test literal `%` or `_` in a synthetic note too. | |
| E13 | With enough notes to show Load more, use it and change the search/filter. | Additional entries load without duplicates; old results do not leak into the new filter. | |
| E14 | Delete a disposable thought, first canceling the confirmation, then confirming. | Cancel keeps it; confirmation removes only that thought. A reload does not bring it back. | |
| E15 | Open one thought in two tabs. Save an edit in tab A, then try saving an older edit in B. | B reports a stale/conflicting update rather than silently overwriting A. Preserve your B text before reloading. | |

## 5. PWA Compose

Create three short source thoughts: `TEST — A: Draft complete`, `TEST — B: Review tomorrow`, and `TEST — C: Approval needed`.

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| D01 | In Compose, select the three thoughts; move C above A and remove B from the selection. | The selected list follows your chosen order; B still exists in Library. | |
| D02 | Choose Keep my words and combine two or more thoughts. | A new thought joins the wording in the selected order, leaving source thoughts intact. This mode works without AI consent. | |
| D03 | Repeat with Email, Progress update, and Checklist. | Each produces the selected structure without inventing deadlines, approvals, or completed work. The originals remain in Library. | |
| D04 | Try combining fewer than two thoughts; check the 20-clip selection limit if you have enough test notes. | The UI prevents unsupported selections or explains the limit, without losing selected items. | |

## 6. PWA V2 organization and reusable tools

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| V01 | In Workspace tools, add `TEST Work` and `TEST Personal` under Project collections; save and reopen. | Both suggestions persist, including after reload. | |
| V02 | In an editor, assign a collection and tags `urgent` and `review`. Save; also try typing a new collection. | Labels persist and become available in Library filters. | |
| V03 | Combine collection, tag, search, and pinned filters. Try tags with differing capitalization. | Results meet all selected conditions; tags behave case-insensitively. | |
| V04 | Remove a collection suggestion from Workspace tools. | Existing thoughts keep their collection labels and content. | |
| V05 | Add Dictation Operative, Oppenheimer, and a distinctive project name to Personal vocabulary. Save, then dictate and rewrite those terms. | Vocabulary persists and is used as a spelling hint. Record actual accuracy; exact spelling is not guaranteed by this feature. | |
| V06 | Add a template named `TEST Project brief` with instructions: “Use Goal, Decisions, and Next steps. Do not invent facts.” Save and select it before capture. | The resulting draft follows the template; original wording is retained. | |
| V07 | Apply that template to an existing saved thought. Edit the template, save, and apply it to another thought. | Each application creates a new version; updated instructions affect subsequent uses. | |
| V08 | Remove the test template. | It disappears from the picker; existing drafts and versions remain intact. | |
| V09 | Export tools. Make a disposable change, import the export, inspect the staged values, then Save workspace tools. | Import stages for review; saving applies the imported values. Existing Library thoughts are untouched. | |
| V10 | Change tools in two tabs, saving A then stale B. Use Reload saved tools in B. | Stale saving produces a conflict; reload restores the saved server version. | |
| V11 | Try exceeding a relevant limit with test data: 12 tags per thought, 60 vocabulary terms/700 total characters, or 30 templates. | The input is capped or gives a clear validation error; saved data stays valid. | |

## 7. PWA offline capture and recovery

Use the **same browser/home-screen context and signed-in account** throughout each test. Visit online first so the offline shell is available. These tests are especially important on a physical iPhone.

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| R01 | While online, open the app once. Disconnect networking and reopen/reload it. | The offline recording screen loads. It does not pretend the saved Library or AI is available offline. | |
| R02 | Record a short note offline and stop. Close and reopen the app, reconnect, then choose Recover to library. | An unfinished recording persists locally; recovery creates one thought and removes that pending recording after saving. | |
| R03 | During online recording, disconnect before stopping. Try Retry after reconnecting, or Keep for later followed by recovery. | Audio is retained; successful recovery does not create duplicates. | |
| R04 | Produce a failed Add More recording, then recover after reconnecting. | It appends once to the original target thought rather than creating an unrelated note. | |
| R05 | Repeat interruption/recovery for Reply and AI prompt capture. | Reply context or prompt type survives. Recovery saves original words; apply any desired template afterward. | |
| R06 | From unfinished recordings, Download audio and play the file locally. Then discard a disposable pending recording. | Download is usable where the container is intact; discard removes only that pending audio, not saved thoughts. | |
| R07 | On a disposable recording, close the app abruptly after several seconds; reopen. | Any stored chunks are offered for recovery/download. Record what was lost or undecodable; the final chunk and a valid audio container are not guaranteed after a crash. | |
| R08 | Record in tab A; try recording/recovering/discarding that active recording from tab B. | The active recording is protected by a clear busy/lock response; neither tab corrupts it. | |
| R09 | Leave a failed Add More recording, then delete its disposable target thought. Attempt recovery. | Recovery reports that it cannot append and keeps the audio available for download. | |
| R10 | Optional: approach 20 unfinished recordings or the roughly 100 MB local limit using test audio. | Capture reports the limit/storage failure and offers available recovery/download; it does not silently discard older audio. Do not fill your device solely for this test. | |

**Expected limits:** PWA recording is foreground-only; transcription, saved Library access, AI, and server saving require internet. Local pending recordings can be erased by browser-data clearing, private browsing, or storage eviction. They are not encrypted by the app at rest. Do not treat the pending-audio list as a permanent backup.

## 8. Backup, continuity, and usability

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| B01 | Export the Library JSON. Inspect several test entries in the file. | Drafts, originals, versions, pins, collections, and tags are present. Workspace tools require their separate export. | |
| B02 | Import that backup, recording the item count before/after; repeat the same import. | Existing thoughts are not overwritten. Repeating the same import does not produce another duplicate set. Check original segments and versions on an imported item. | |
| B03 | Try importing a harmless non-backup JSON file or malformed copy of your export. | A useful error appears; the current Library remains intact. Keep the original export untouched. | |
| B04 | Open the PWA on another device signed into the same account; reload the Library and tools. | Server-saved thoughts and tools appear. Pending audio and clipboard pairings are device/browser-local and need not appear there. Native Mac history is a separate history. | |
| B05 | On phone, test portrait/landscape, open the editor with the keyboard visible, and scroll long dialogs. | Record/stop, save, close, Sync, and error messages remain reachable; there is no blocking horizontal overflow. | |
| B06 | On desktop, navigate with Tab/Shift-Tab and Enter/Space; try Escape in dialogs and 200% browser zoom. | Focus is visible, fields have meaningful labels, and controls remain usable. Unsaved work is protected. | |
| B07 | During a future PWA update, save work and recover pending audio before accepting the update notification. | Refresh loads the updated app; saved server data remains available. Do not mark this passed without testing an actual update. | |
| B08 | Optional, with a WebMCP-capable browser/assistant: search a TEST thought, open it, and stage a new text capture. | Search/open do not change content; staging fills the form without automatically saving, recording, running AI, copying, or sharing. Mark N/A if unavailable. | |

## 9. Native Mac dictation

Use the installed signed app. Do not replace it with a downloaded ad-hoc CI build just to test updates. Keep your chosen hotkey/settings noted so you can restore them.

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| M01 | Launch the app and open Setup / Permissions. With prerequisites granted, return to dictation. | One app is running; setup reflects current permissions/model readiness. An unnecessary permission loop is a failure. | |
| M02 | In an empty TextEdit document, tap Control + Option, speak, tap again. | Recording toggles on/off and inserts once at the cursor. Use your configured key if different. | |
| M03 | Hold the dictation key, speak, release; separately test a quick tap. | Holding records until release; a quick tap acts as toggle mode. | |
| M04 | Use a normal shortcut containing those modifiers, such as Control + Option + an arrow. | It does not leave dictation recording unintentionally. | |
| M05 | Change Dictation key; set and test extra toggle and hold-to-talk shortcuts, then restore your preference. | Each configured shortcut works; removed bindings stop activating. | |
| M06 | Use menu actions Start Dictation, Stop & Insert, and Cancel Recording. Also cancel processing if you can catch that state. | Start/stop work; cancel does not later insert abandoned text. The indicator returns to idle. | |
| M07 | Turn live transcript on and speak, then turn it off and repeat. | Enabled mode shows interim words while recording; final insertion occurs only after stop. Disabled mode still dictates normally. | |
| M08 | Dictate into TextEdit, a browser text field, and an empty VS Code/editor document. Try inserting at a cursor and replacing selected text. | Text lands once at the intended location. Record differences by destination app. Avoid submitting anything. | |
| M09 | Copy a test marker, select Always paste, and dictate into a document. Paste afterward elsewhere. | Dictation inserts, then your pre-existing clipboard is restored. If you copy something new during processing, it must not be overwritten by restoration. Restore your preferred insertion mode. | |
| M10 | Remove text-field focus or close the destination while dictation processes. | Failure/fallback is understandable and text remains recoverable through Copy Last or History; unrelated content is not changed. | |
| M11 | In Model settings, download another model if desired, choose Use, and dictate. Delete an unused downloaded model. | Progress, ready/active state, switching, and deletion are coherent. Keep a working model installed. | |
| M12 | With a multilingual model, select Auto-detect and speak a language you can assess. Return to English afterward. | The selected model/language are respected. Mark N/A if you cannot assess recognition. | |
| M13 | With a model already downloaded and cleanup off, disconnect networking and dictate. | On-device transcription still inserts. Then enable cloud cleanup offline and repeat: raw text should remain available instead of being lost. | |
| M14 | Enable cleanup, configure your provider, Test Connection, and dictate the messy sample. | Connection feedback is accurate; cleaned text keeps meaning. Repeat for each provider you actually use; unsupported/unconfigured providers are N/A. | |
| M15 | Add a custom dictionary term, dictate it with cleanup on, then remove it. | The term persists and influences cleanup; compare the resulting spelling. | |
| M16 | Enable spoken editing. After a fresh insertion in the same app, try scratch that, delete last sentence, delete last word, make that uppercase, and make that lowercase. Use a new sample where needed. | Each command edits the last eligible dictation instead of inserting the command phrase. | |
| M17 | With AI available, try make that a bullet list and make that more formal. | The last eligible insertion is rewritten appropriately. | |
| M18 | After dictation, switch destination app, modify the inserted text, or wait over two minutes before issuing an edit command. | The app does not blindly delete or replace unrelated/stale text. Record the refusal or fallback behavior. | |
| M19 | Enable Adjust tone by app. Add/edit/remove an app-style rule and try Add suggested rules. Dictate the same sample in two applicable apps. | Rules persist and influence tone when cleanup is active, without changing facts. | |
| M20 | Use Copy Last, Recent History, and Settings → History. Quit and relaunch. | Expected transcripts can be copied; history, hotkeys, model choice, and settings persist. | |
| M21 | Optional: copy/export anything you need from native history, then Clear History. | History is cleared. This is broad deletion—skip if you want to keep it. | |
| M22 | Enable Launch at login; test at your next login. Open About Dictation. | Only the intended installed app launches; About reports the expected build. Restore your login preference. | |
| M23 | At the next consistently signed update, quit the installed app, use the established installer, reopen, and dictate. | Accessibility remains recognized and setup does not loop. Mark Blocked until a real replacement build is available. | |
| M24 | If Check for Updates is available, open it. | It gives an update/current-version result or actionable error. If not configured, absence is expected; no automatic-update claim is verified by a source merge alone. | |

## 10. Cross-device Sync — text, images, and dictation

Mac: **Settings → Sync** or menu-bar **Sync**. PWA: **Sync**. PWA thought editor: **Send to device**. Pairing is distinct from signing into the PWA. Browser automatic clipboard monitoring is not part of this release.

| ID | Do this | Pass when | Result |
| --- | --- | --- | --- |
| S01 | Name devices `TEST Mac` and `TEST Phone`. Create a private invitation, enter it on the other device, request pairing, then approve on the creator. | Sending is blocked until explicit trust approval; the correct named device appears. | |
| S02 | Try an incomplete invitation and one older than five minutes. | Errors explain the failure; neither silently creates a trusted pair. | |
| S03 | Save a changed device name and reopen Sync. With another pair available, switch selected destination. | Names/selection persist, and transfers go only to the selected peer. Mark the multi-peer portion N/A if unavailable. | |
| S04 | Copy the exact clipboard text on Mac; Send clipboard; Receive latest on PWA; paste into Notes. Reverse the direction. | Both pastes exactly preserve Unicode, punctuation, and line breaks. Receipt/success is shown without interrupting dictation. | |
| S05 | Save a PWA dictation; choose Send to device and Send current dictation. On Mac, Receive latest and paste. | The saved current draft transfers. Unsaved edits must be saved before the editor’s send action. | |
| S06 | On Mac, use Send last dictation. Then enable automatic completed-dictation delivery and dictate a new sentence. | The selected peer receives the intended text; turn the automatic option off again after testing. | |
| S07 | Copy an actual screenshot/image, Send clipboard, Receive latest, and paste normally into Notes/TextEdit. Repeat both directions. | A real image appears, not a link, filename, or thumbnail reference. | |
| S08 | Repeat with the 64 × 32 transparency fixture. Inspect/save the pasted image in an app that preserves PNG. | Dimensions stay 64 × 32; transparent and half-transparent bands remain. A destination app that flattens images needs a second app for confirmation. | |
| S09 | On Mac, test copied TIFF image content; also copy a web image URL and a Finder file separately. | TIFF converts to an actual lossless PNG when supported. URLs transfer as text; file references are rejected as image content rather than mistaken for the image. | |
| S10 | Deny browser clipboard read access and use “Clipboard access blocked? Paste here to send.” Paste text, then an actual image. | The user-initiated fallback transfers both. Unsupported receiving permissions/formats produce a clear error, not false success. | |
| S11 | Transfer a PNG over 1 MB, then one over 8 MiB or 40 megapixels if available. Test clipboard text over 256 KiB if practical. | A larger allowed transfer shows progress and pastes intact. Over-limit items are rejected without changing the destination clipboard. | |
| S12 | Pause Sync; attempt manual send/receive and Mac automatic delivery. Resume. | Paused actions are blocked; resumed operation is predictable. Already completed clipboard writes are not undone by pause. | |
| S13 | Enable Mac automatic clipboard sync. Copy fresh test text on a connected peer and explicitly send it from the PWA; then copy a new marker on Mac. | Mac automatically receives the new peer item and sends its local copy. PWA still needs Receive latest; receiving does not create a ping-pong loop. | |
| S14 | With automatic Mac mode on, transfer one item and leave both devices idle for 30 seconds. | No repeated transfers, repeated clipboard changes, or endlessly changing status occur. | |
| S15 | Disconnect a receiver, send an item, and reconnect within two minutes after copying a newer local marker. | Reconnection does not automatically replace the newer clipboard with the pending older item; explicit Receive latest can retrieve it while unexpired. | |
| S16 | Send an item and leave it unreceived for over two minutes. | It expires and cannot later overwrite the clipboard; send again to retry. A suspended/offline device should not be expected to receive in the background. | |
| S17 | Send A then B before receiving. Also try near-simultaneous copies in both directions. | Latest pending content wins per direction; stale items do not later reappear. Record send order and pasted results for concurrent-copy failures. | |
| S18 | Interrupt an image upload by disconnecting networking, then reconnect and send again. | No partial image is pasted; the fresh retry completes. Failure/progress feedback is clear. | |
| S19 | Start receiving a larger image on Mac and copy a newer local marker before it finishes. | Automatic/native receive does not overwrite that newer local clipboard; it reports the conflict. Repeat if the transfer finishes too quickly to reproduce. | |
| S20 | Remove a trusted device while both are online; attempt another transfer from the old peer. | Trust is revoked, pending content removed, and old authorization cannot continue transferring. New pairing is required. | |
| S21 | Pair and test over separate networks, such as Mac Wi-Fi and phone cellular. | Text and images still transfer while both are awake/online. Measure observed delay; do not assume a guaranteed latency. | |

After Sync tests, disable automatic mode or leave it at your intended setting, remove disposable pairings, and put normal content back on your clipboard.

## 11. What counts as a release blocker?

- **Blocker:** lost saved notes/audio without a stated limitation, another account’s data exposed, transfer to the wrong device, stale automatic clipboard overwrite, broken text/image transfers, repeated permission loops, or the core recording/save flow failing.
- **Major:** recoverable failures in editing, versions, filters, backups, offline recovery, templates, or normal phone use.
- **Minor:** wording, spacing, confusing status, or isolated recognition quality issues with preserved source material.
- **Expected limitation:** PWA background recording, offline AI/transcription, browser automatic clipboard monitoring, automatic native/PWA history merging, native Windows/Linux/iOS apps, iOS keyboards/share extensions, billing, meeting bots, and broad integrations are not implemented features to pass.

Manual tests can validate visible behavior. They cannot prove end-to-end encryption, server deletion/backups, account isolation across all endpoints, or absence of sensitive logs. Those require engineering/security checks in addition to this guide. The PR review passed 55 Mac tests and 9 relay tests; those do not replace physical-device acceptance.

## 12. Copy this issue report when something fails

```text
Test ID:
Short description:
Severity: Blocker / Major / Minor
Device, OS, browser, and app build:
Published PWA / home-screen PWA / native Mac:
Network: Wi-Fi / cellular / offline / reconnecting
Steps to reproduce:
1.
2.
3.
Expected:
Actually happened:
Exact error message:
Repeatable? (for example, 3 out of 3 attempts)
Was any text/audio/clipboard content lost or changed?
Screenshot or short screen recording:
Workaround, if any:
```

Do not include API keys or pairing invitations in screenshots or reports. Use the synthetic TEST content when reproducing issues.

## 13. Finish the session

- Record totals: **Pass ___ / Fail ___ / Blocked ___ / N/A ___**.
- List any untested physical-device, offline/reconnect, and real-update cases explicitly.
- Keep backup files, recover/download pending recordings, and delete only disposable TEST notes and tools.
- Restore your intended microphone, cloud consent, hotkeys, cleanup, launch-at-login, and Sync settings.
- Retest each failed case after its fix, then repeat the quick pass.

**Acceptance decision:** Ready / Ready with known issues / Not ready. Add the date and unresolved test IDs.
