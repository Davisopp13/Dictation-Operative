# Dictation Operative — step-by-step testing checklist

Work from top to bottom. You can stop after any numbered section and resume later.

**Check a box only when it works.** If it fails, write **FAIL** beside it and take a screenshot. If you cannot test it yet, write **SKIP — reason**. Keep using the same test notes throughout.

**Your test date:** __________  **Device/browser:** __________

## Part 1 — Test the website

Start on your Mac. Repeat sections 2–5 on your iPhone afterward.

### 1. Get ready

- [ ] Open [DO Voice Workspace](https://do-voice-workspace.davisopp.workers.dev/).
- [ ] Open a blank note in Apple Notes or TextEdit for pasting test results.
- [ ] If you already have saved thoughts, export your Library backup.
- [ ] Open **Workspace tools** and choose **Export tools** too. Keep both backup files.
- [ ] Open **Settings**. Check that Groq is connected and **Allow cloud processing** is on. Connect your key if needed.
- [ ] Close Settings. Open **Capture**, **Library**, and **Compose** in turn.

**Look for:** Every page opens normally. Your existing thoughts remain available. AI tests will use your connected provider allowance.

### 2. Record your first test note

- [ ] Open **Capture → Note**.
- [ ] Tap the microphone. Allow microphone access if asked.
- [ ] Say: “Um, please send the project update to Morgan by Friday at three PM. The budget is forty-two dollars and fifty cents.”
- [ ] Tap the stop button. Wait for the thought to save.
- [ ] Open the saved thought. Rename it **TEST — First recording** and choose **Save**.
- [ ] Open **Original** and read what was captured.
- [ ] Close the thought, reload the page, and reopen it from **Library**.

**Look for:** One saved thought, a stopped microphone, and a title that survives reload. Note any errors in names, numbers, or wording.

### 3. Edit, clean up, and undo

- [ ] Open **TEST — First recording → Current draft**.
- [ ] Add “This is a test.” and choose **Save**.
- [ ] Make another edit, but choose **Undo edits** instead of saving.
- [ ] Choose **Clean up**. Read the result.
- [ ] Choose **Rewrite**. Read that result too.
- [ ] Open **Versions**. Expand an older version and choose **Restore**.
- [ ] Open **Original** and choose **Restore original**.

**Look for:** Undo removes only unsaved edits. Cleanup and rewriting preserve the facts. Older versions and original words remain recoverable.

### 4. Add more to the same thought

- [ ] In the current draft, choose **Add more to this thought**.
- [ ] Record: “We also need to review the blue icon.” Stop and let it save.
- [ ] Open **Add more to this thought** again.
- [ ] Under **Or add a few words**, type “Approval is still pending.” Choose **Add text**.
- [ ] Open **Original**. Find the separate segments.
- [ ] On one segment, choose **Draft without this segment**.
- [ ] Return to **Original** and confirm the omitted segment is still there.

**Look for:** Additions stay in the same thought. Removing a segment from the draft does not erase its original words.

### 5. Copy, share, and export

- [ ] Copy the current draft and paste it into your blank Notes/TextEdit document.
- [ ] Use **Copy original** and paste underneath it.
- [ ] Copy an older entry from **Versions** and paste that too.
- [ ] Choose **Share**, then cancel the share sheet. If sharing is unsupported, check the offered fallback.
- [ ] Choose **Export text** and open the downloaded file.

**Look for:** Each copy matches the selected version. Export matches the current draft. Canceling Share does not change or send your thought.

### 6. Write and paste without recording

- [ ] Return to **Capture → Note → Write a thought**.
- [ ] Type two paragraphs, including an emoji. Save as **TEST — Typed note**.
- [ ] Copy a sentence from Notes. Return to Capture and choose **Paste**.
- [ ] If clipboard permission is blocked, paste manually into the text field.
- [ ] Save it as **TEST — Pasted note**.
- [ ] Start typing another thought, leave it unsaved, and try recording.
- [ ] Confirm your typed text is protected; then save or clear that disposable text.

**Look for:** Paragraphs and emoji survive. Paste happens only after your action. Recording does not silently replace unsaved text.

### 7. Create a reply

- [ ] Open **Capture → Reply**.
- [ ] In **What are you replying to?**, paste: “Can you share the project status and tell me what you need from me?”
- [ ] Record or type: “The draft is done. Testing starts tomorrow. I need approval for the blue icon. No launch date is agreed yet.”
- [ ] Save and review the reply. Name it **TEST — Reply**.
- [ ] Open **Original** and check the incoming message and your reply points.
- [ ] In the editor, try **Draft reply** again.

**Look for:** A useful reply without invented promises. Both source inputs remain available. The app does not send the reply for you.

### 8. Create an AI prompt

- [ ] Open **Capture → AI prompt**.
- [ ] Record or type: “Help me plan a five-day trip to Boston for two adults. We enjoy museums and walking. Give me a daily itinerary. I haven’t set a budget.”
- [ ] Save it as **TEST — Trip prompt**.
- [ ] Read the generated prompt and inspect **Original**.
- [ ] Open a regular saved note and try its editor’s **AI prompt** action too.

**Look for:** Goal, context, constraints, and output are organized clearly. An unspecified budget is not invented. Original words remain intact.

### 9. Organize your Library and internal clipboard

- [ ] Open **Workspace tools**. Add **TEST Work** and **TEST Personal** as project collections. Save.
- [ ] Open **TEST — First recording**. Assign **TEST Work** and tags **urgent** and **review**. Save the labels.
- [ ] Pin that thought.
- [ ] In Library, open the pinned view and find it.
- [ ] Search for **First recording**, then a word inside its draft.
- [ ] Select its collection and tag filters together. Confirm the thought still appears.
- [ ] Search for a nonexistent word. Check the empty state, then clear search and filters.
- [ ] Unpin the thought and confirm it leaves the pinned view.
- [ ] Remove **TEST Work** from collection suggestions in Workspace tools. Reopen the thought.

**Look for:** Filters work together. Pinning keeps an item handy inside the app; it does not copy it to your system clipboard. Removing a collection suggestion does not remove existing labels or thoughts.

### 10. Combine thoughts

- [ ] Create three typed notes: **TEST — A: Draft complete**, **TEST — B: Review tomorrow**, and **TEST — C: Approval needed**.
- [ ] Open **Compose** and select all three.
- [ ] Move C above A. Remove B from the selection.
- [ ] Choose **Keep my words** and combine the remaining two.
- [ ] Check that the new draft follows the selected order.
- [ ] Repeat with **Email**, **Progress update**, and **Checklist**.
- [ ] Return to Library and confirm A, B, and C are still there.

**Look for:** Each format produces a new draft. Source notes are untouched; AI does not invent deadlines or approvals.

### 11. Test personal vocabulary and voice templates

- [ ] Open **Workspace tools → Personal vocabulary**.
- [ ] Add **Dictation Operative**, **Oppenheimer**, and one distinctive project name. Save.
- [ ] Record a note containing those words. Check the spellings; then try rewriting it.
- [ ] In Workspace tools, choose **Add template**. Name it **TEST Project brief**.
- [ ] Enter: “Use Goal, Decisions, and Next steps. Do not invent facts.” Save.
- [ ] Select this template in Capture and record a short project note.
- [ ] Open another saved thought, select the template, and choose **Apply template**.
- [ ] Edit the template instructions, save, and apply it again to a disposable thought.
- [ ] Remove the test template. Confirm previously generated drafts remain available.

**Look for:** Vocabulary is saved and influences spelling, though recognition is not guaranteed. Templates shape drafts and create recoverable versions without changing originals.

### 12. Test backups and deletion

- [ ] Export the Library again, now including your TEST thoughts. Keep this file separate from your first backup.
- [ ] Import that test backup. Confirm existing thoughts were not overwritten.
- [ ] Import the same file again. Confirm it does not add another duplicate set.
- [ ] Check an imported thought’s original, versions, pin, collection, and tags.
- [ ] Export Workspace tools. Make a disposable change, then import that tools file.
- [ ] Review the imported tools before choosing **Save workspace tools**.
- [ ] Delete one disposable TEST thought. First cancel the confirmation; then repeat and confirm deletion.
- [ ] Reload and check that only the intended thought was removed.

**Look for:** Both backups restore the expected information. Tools import waits for your save action. Canceling deletion keeps the thought.

### 13. Test offline recording and recovery

Do this in the same browser or home-screen app throughout. Do not clear its browser data.

- [ ] Open the workspace while online so the offline screen can be saved.
- [ ] Disconnect from the internet. On a phone, make sure cellular data is off too.
- [ ] Reload/reopen the app. Find the offline recording screen.
- [ ] Record: “TEST — This note was recorded offline.” Stop.
- [ ] Close and reopen the app, then restore internet access.
- [ ] Find **Unfinished recordings on this device** and choose **Recover to library**.
- [ ] Confirm one thought saved and the pending recording disappeared.
- [ ] Repeat by starting online, disconnecting before stopping, then reconnecting and choosing **Retry** or **Keep for later → Recover to library**.
- [ ] For another disposable pending recording, choose **Download audio** and play the file. Then discard that pending recording.

**Look for:** Saved audio survives reopening and recovers without duplicate thoughts. Transcription, AI, and the saved Library still require internet. A download/discard action does not delete saved thoughts.

### 14. Test on your iPhone

- [ ] Open the published workspace on your phone and sign into the same account.
- [ ] Use the app’s installation guidance to add it to the home screen. Launch it from that icon.
- [ ] Repeat sections **2–5**: record, edit, add more, copy/share/export.
- [ ] Confirm server-saved Library thoughts and Workspace tools from your Mac appear after reload.
- [ ] Open a long thought with the keyboard showing. Reach Save and Close.
- [ ] Rotate the phone and check that controls remain usable.
- [ ] Start a disposable recording, switch apps or lock the phone, then return.
- [ ] Repeat section **13** on the phone.

**Look for:** The app works at phone size. Backgrounding stops recording; it is not a background dictation service. Pending recordings and Sync pairings belong to that browser/device and do not automatically appear elsewhere.

## Part 2 — Test the native Mac app

### 15. Test tap-to-record and hold-to-talk

- [ ] Open **Dictation** from Applications. Open a blank TextEdit document.
- [ ] If needed, finish **Setup / Permissions** and download a model. Start with AI cleanup off.
- [ ] Tap **Control + Option**, say “TEST — Tap to record works,” then tap again.
- [ ] Confirm the words appear once at the cursor and recording stops.
- [ ] Hold **Control + Option**, say “TEST — Hold to talk works,” then release.
- [ ] Confirm the words appear once after release.
- [ ] Use your normal shortcut containing those modifiers, such as Control + Option + an arrow. Confirm it does not leave recording on.
- [ ] From the menu bar, try **Start Dictation**, **Stop & Insert**, and **Cancel Recording**.
- [ ] Quit and reopen Dictation, then dictate again.

**Look for:** Both recording styles work. Cancel does not insert abandoned text. Relaunch does not trap you in setup when permissions and the model are ready. If your configured key differs, use that key.

### 16. Test Mac settings and insertion

- [ ] In **Settings → General**, change the dictation key and test it.
- [ ] Assign and test an extra toggle shortcut and an extra hold-to-talk shortcut. Restore your preferred bindings afterward.
- [ ] Enable **Show live transcript while recording**. Dictate, then disable it and repeat.
- [ ] Dictate into TextEdit, a browser text field, and an empty editor document. Test both cursor insertion and replacing selected text.
- [ ] Copy **TEST — Keep my clipboard**. Select **Always paste**, dictate into TextEdit, then paste into a different blank note.
- [ ] Confirm the old clipboard marker was restored. Restore your preferred insertion setting.
- [ ] With a model already downloaded, disconnect networking and dictate with cleanup off. Reconnect afterward.
- [ ] Use **Copy Last**, **Recent History**, and **Settings → History** to retrieve test text.

**Look for:** Text lands in the intended place; your clipboard is restored after temporary paste insertion; on-device dictation works offline. Live preview does not insert text before you stop. Do not submit messages or run terminal commands for these tests.

### 17. Test Mac cleanup and spoken editing

- [ ] In **Settings → Cleanup**, configure your provider and choose **Test Connection**.
- [ ] Enable cleanup. Dictate: “Um, so we should, like, finish the draft Friday and review it Monday.”
- [ ] Add a custom dictionary term and dictate it. Check that it persists after reopening Settings.
- [ ] Enable **Edit the last dictation with spoken commands**.
- [ ] Dictate a fresh sentence in TextEdit. Record the command **“scratch that.”** Confirm the last insertion is removed.
- [ ] Dictate two fresh sentences. Test **“delete last sentence.”**
- [ ] Dictate another fresh sentence. Test **“delete last word.”**
- [ ] On fresh text, test **“make that uppercase”** and **“make that lowercase.”**
- [ ] With AI connected, test **“make that a bullet list”** and **“make that more formal.”**
- [ ] Enable **Adjust tone by app**, add a style rule, and compare a sample in two applicable apps.

**Look for:** Cleanup improves wording without changing facts. Commands edit the last eligible insertion in the same app within two minutes. Originals/history remain useful for recovering text.

## Part 3 — Test Sync between Mac and phone

Keep both devices awake and online. Begin with Mac automatic Sync turned **off**. Use synthetic clipboard content while testing.

### 18. Pair your devices

- [ ] On Mac, open **Dictation → Settings → Sync**. Set its name to **TEST Mac** and save.
- [ ] On your phone, open the PWA’s **Sync** area. Name it **TEST Phone** and save.
- [ ] On Mac, choose **Create private invitation**.
- [ ] Copy the invitation to your phone, paste it into Sync, and choose **Request pairing**.
- [ ] Before approval, confirm sending is unavailable.
- [ ] On Mac, choose **Trust and pair “TEST Phone.”**
- [ ] Confirm each device shows the other as its selected destination.

**Look for:** A named, approved pair. Complete this within five minutes; create a fresh invitation if it expires. Pairing is separate from signing into your account.

### 19. Send text in both directions

- [ ] On Mac, copy these two lines:

  ```text
  TEST — café 🎙️ — line one
  Line two: $42.50 / Friday 3:00 PM
  ```

- [ ] On Mac, choose **Send clipboard**.
- [ ] On phone, choose **Receive latest**. Paste into a blank Apple Note.
- [ ] Compare the pasted words, emoji, punctuation, and line break.
- [ ] Copy different test text on the phone and choose **Send clipboard** in the PWA.
- [ ] On Mac, choose **Receive latest** and paste into TextEdit.
- [ ] If the PWA cannot read the clipboard, expand **Clipboard access blocked? Paste here to send**, paste there, and choose **Send pasted text**.

**Look for:** Exact text each way, with clear send/receive status. Receiving puts it on the destination clipboard; you still paste it into the target app yourself.

### 20. Send completed dictation

- [ ] Open a saved PWA thought. Save any edits.
- [ ] Choose **Send to device**, then **Send current dictation**.
- [ ] Receive on Mac and paste. Confirm it matches the saved draft.
- [ ] Dictate a new sentence with the native Mac app.
- [ ] From its Sync menu, choose **Send last dictation**.
- [ ] Receive on the phone and paste.
- [ ] On Mac, enable automatic completed-dictation delivery. Dictate again, then receive on the phone.
- [ ] Turn that automatic option off again unless you want to keep it.

**Look for:** The intended text reaches the selected peer without interrupting ordinary dictation.

### 21. Send screenshots and transparent images

- [ ] Copy an actual screenshot/image on Mac. Do not just copy its file in Finder.
- [ ] Choose **Send clipboard**. Receive on phone and paste into Notes.
- [ ] Copy an image on phone. Send it, receive on Mac, and paste into TextEdit or another image-capable app.
- [ ] Repeat with [this transparent PNG test image](/Users/davis/Dictation%20Operative/macos/SyncValidation/transparency.png). Open it in an image app and copy the image content.
- [ ] Inspect the pasted image in an app that preserves transparency.
- [ ] If browser image reading is blocked, use the Sync paste fallback and **Send pasted image**.

**Look for:** A real image, not a filename or URL. The test PNG remains 64 × 32 with transparent, half-transparent, and opaque bands. A destination app may flatten transparency; verify in another image app if needed.

### 22. Test pause, automatic Sync, and reconnecting

- [ ] Choose **Pause Sync**. Confirm manual transfers and automatic delivery are blocked. Resume.
- [ ] Enable Mac automatic clipboard Sync. Keep both devices connected for a few seconds.
- [ ] Send new test text from the PWA. Confirm Mac receives it automatically.
- [ ] Copy new test text on Mac. On phone, choose **Receive latest** and paste.
- [ ] Leave both devices idle for 30 seconds. Confirm transfers do not repeat endlessly.
- [ ] Disconnect Mac networking. Send a new item from the phone.
- [ ] Copy **TEST — Newer local clipboard** on Mac. Reconnect within two minutes.
- [ ] Confirm reconnecting does not automatically overwrite that local marker. Use **Receive latest** explicitly if you want the pending item.
- [ ] Turn off automatic Sync. Send another item but do not receive it for over two minutes. Confirm it expires.
- [ ] If possible, repeat one text and image transfer with phone cellular and Mac Wi-Fi.
- [ ] Remove the test pairing. Confirm the old peer can no longer transfer without pairing again.

**Look for:** Clear pause/resume behavior, no transfer loops, no stale automatic overwrites, and expired/revoked transfers staying unavailable. The PWA still requires explicit clipboard actions.

## Part 4 — Extra checks before calling the release ready

Do these after the everyday flows above. Skip unavailable hardware or future-update tests and write why. Use only disposable test data.

### 23. Permissions and error handling

- [ ] Open the site in a signed-out private browser session. Confirm it does not expose your private Library.
- [ ] Turn cloud consent off. Confirm AI is blocked but typed Note saving still works. Restore consent.
- [ ] If your valid Groq key is available, test an invalid key, then disconnect/reconnect with the valid one. Check honest connection/error feedback and preserved notes.
- [ ] Deny browser microphone access, try recording, then allow it and retry. Confirm actionable guidance and recovery.
- [ ] Try saving blank text and starting a Reply without an incoming message. Confirm useful validation.
- [ ] Open Settings’ privacy information. Confirm it loads.
- [ ] Try a harmless invalid backup/tools file. Confirm a clear error and no saved-data changes.

### 24. Saving safely in two tabs

- [ ] Open a disposable thought in two tabs. Save an edit in A, then try saving the older copy in B. Confirm B warns of a conflict rather than overwriting A.
- [ ] Repeat with Workspace tools. Use **Reload saved tools** in B to recover the current version.
- [ ] Edit a thought without saving and try closing/navigating away. Confirm protection from silent loss.
- [ ] Record in A and try recording or recovering/discarding that active recording in B. Confirm the active recording is protected.

### 25. Recovery under interruption

- [ ] Repeat the offline-failure/recovery steps for **Add More**. Confirm it appends once to the correct thought.
- [ ] Repeat for **Reply** and **AI prompt**. Confirm the intended type and incoming-message context survive.
- [ ] On a disposable recording, close the app abruptly after several seconds. Reopen and try recovery/download. Note missing final words or an unreadable file; crash recovery cannot guarantee the final chunk or a valid audio container.
- [ ] Leave a failed Add More recording, delete its disposable target thought, then recover. Confirm an error keeps audio available for download.
- [ ] Record to the five-minute limit. Confirm capture stops and releases the microphone.
- [ ] Repeat recognition with quiet speech, pauses, names, numbers, and emoji-related wording. Record accuracy issues separately from lost-data bugs.

### 26. Sync edge cases

- [ ] Try an incomplete invitation and an invitation older than five minutes. Confirm neither establishes trust.
- [ ] Rename a paired device and reopen Sync. Confirm the saved name. If you have a third device, switch destinations and verify only the selected peer receives.
- [ ] Send A and then B before receiving. Confirm B is the latest pending item. Try near-simultaneous sends in both directions and record the results.
- [ ] Send a PNG larger than 1 MB. Confirm progress and an intact paste.
- [ ] Interrupt that upload by disconnecting, then reconnect and send again. Confirm no partial image is pasted.
- [ ] While Mac receives a larger image, copy a newer local marker. Confirm the pending receive does not overwrite it. Retry if the image arrived too quickly to reproduce.
- [ ] If available, copy TIFF image content on Mac and transfer it. Confirm a real PNG image arrives.
- [ ] Separately copy an image URL and a Finder file. Confirm the URL is text and the file reference is not mistaken for image bytes.
- [ ] If convenient test files exist, try an image over 8 MiB or 40 megapixels, or text over 256 KiB. Confirm a clear size error and an unchanged destination clipboard.

### 27. Mac settings, protection, and updates

- [ ] Download and switch to another model if desired; delete an unused model. Keep one working model installed.
- [ ] If you can assess another language, use a multilingual model with Auto-detect. Check recognition and restore your preference.
- [ ] Try cleanup with networking off. Confirm raw dictation remains available; reconnect afterward.
- [ ] Try an edit command after switching apps, manually changing the last insertion, or waiting more than two minutes. Confirm unrelated text is not blindly replaced.
- [ ] Close the destination during processing. Confirm recoverable text or clear fallback rather than changes to an unrelated app.
- [ ] Copy new text during temporary paste insertion. Confirm restoring the old clipboard does not overwrite the newer copy.
- [ ] Edit/remove per-app style rules and try **Add suggested rules**. Confirm saved behavior.
- [ ] Test each AI provider you actually use. Skip providers you have not configured.
- [ ] Enable **Launch at login** and test at your next login. Check **About Dictation** for the build.
- [ ] If offered, try **Check for Updates**. Record a clear result or error. If absent because it is unconfigured, mark SKIP.
- [ ] At the next signed update, install through the established update process and dictate again. Confirm Accessibility is still recognized. Do not replace your installed app with an ad-hoc test build for this check.
- [ ] Optional: preserve anything needed from Mac history, then **Clear History**. Skip this if you want to retain it.

### 28. Usability, limits, and optional tools

- [ ] On desktop, use Tab/Shift-Tab, Enter/Space, and Escape. Confirm visible focus, reachable actions, and safe dialog closing.
- [ ] Zoom to 200%. Confirm essential controls remain usable.
- [ ] Search a test note containing `%` or `_`. Confirm literal search behavior. Test tag capitalization too.
- [ ] If **Load more** appears, use it, then change search/filters. Confirm no duplicate or stale results.
- [ ] Try composing fewer than two thoughts. If convenient, test the 20-thought maximum.
- [ ] Test a newly typed collection name, then combine search, collection, tag, and pinned filters.
- [ ] If convenient, test limits of 12 tags, 60 vocabulary terms/700 total characters, or 30 templates. Confirm clear validation.
- [ ] Optional: test unfinished-recording limits of 20 items or roughly 100 MB. Do not fill your device just to run this test.
- [ ] At the next PWA update, save work and recover pending audio before accepting the update. Confirm the updated app retains saved thoughts.
- [ ] If a WebMCP-capable assistant is available, ask it to search, open, and stage a TEST thought. Confirm staging does not automatically save, record, run AI, copy, or share. Otherwise mark SKIP.

## Finish

- [ ] Recover or download any audio you want to keep before clearing browser data.
- [ ] Delete only disposable TEST thoughts, vocabulary entries, templates, and pairings.
- [ ] Restore your preferred cloud consent, hotkeys, cleanup, login, and Sync settings.
- [ ] List failed and skipped steps below.
- [ ] After fixes, repeat the failed step and the main recording → save → paste flow.

**Failed steps:** __________________________________________

**Skipped steps and why:** __________________________________

**Ready to use?** Yes / Yes with known issues / No

### Send me this when something fails

```text
Step number:
Device and browser:
What I clicked or said:
What I expected:
What happened instead:
Exact error / screenshot:
Did it happen again when I retried?
Was anything lost or pasted in the wrong place?
```

Keep API keys and private pairing invitations out of screenshots.

**Expected limits:** The PWA needs internet for transcription, AI, and saved Library access. Phone recording stops in the background. Native Mac history and PWA history are separate. Browser clipboard actions are manual. Crash recovery is best-effort. Native iOS/Windows/Linux apps, keyboards, meeting bots, and billing are not included.

This checklist checks visible behavior; it does not replace technical security validation. The [detailed testing guide](/Users/davis/Dictation%20Operative/docs/manual-testing-guide.md) remains available for exact test IDs and fuller acceptance criteria.
