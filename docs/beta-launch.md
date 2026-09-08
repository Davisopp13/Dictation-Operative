# Dictation Operative beta

Prepared September 8, 2026. Scope: website + Apple Silicon Mac app + Sync.
Status: preparing; this document is not approval to announce availability.

## Already available

- GitHub: https://github.com/Davisopp13/Dictation-Operative (existing public repository).
- Website: https://do-voice-workspace.davisopp.chatgpt.site/ (currently owner-only).
- The website has a separate Sites source repository; no new repository is needed.
- Developer ID Application signing certificate installed on the development Mac.
- Website typecheck, lint, production build, and 46 tests passed September 8.
- Sync relay typecheck, dry-run packaging, and 17 tests passed September 8.
- Native unit tests: 63 passed September 8; physical-device acceptance remains pending.

## Release preparation

- [x] Finish native unit tests.
- [x] Prepare signed beta build: 0.2.0 beta 1, Apple Silicon; Developer ID signature and hardened runtime verified September 8.
- [x] Store Apple notarization credentials locally; submit and staple app and DMG (`DO-beta` profile; Apple accepted app and DMG September 8).
- [ ] Finish device acceptance below and fix any blocking failures.
- [ ] Test an independent signed-in account after granting beta access.
- [ ] Preserve the exact native source, including current uncommitted fixes, before creating a release tag.
- [ ] Publish the notarized DMG and checksum as a GitHub prerelease, with installation instructions and known limitations.
- [ ] Set the website's agreed beta access and verify the tester sign-in path.

The first Mac beta uses manual download updates. Sparkle is deliberately disabled
in this beta build; automatic updates require separate key/feed setup. GitHub's
stable `releases/latest` URL excludes prereleases. Do not upload a beta appcast to
the stable update feed or use the stable release workflow to publish a beta.

Current candidate: `DerivedData/Beta/0.2.0-beta.1.B62ve5/Dictation-0.2.0-beta.1-arm64.dmg`
(SHA-256 `c0e9f5d6905b764f2c0778f19429ae38215e425edf323ecf2cd3abe0e1f919b9`).
App and DMG are notarized, stapled, and pass Gatekeeper
(`source=Notarized Developer ID`). Apple rejected the first submission because
Xcode left Sparkle's nested helpers (`Autoupdate`, `Updater.app`, the two XPC
services) ad-hoc signed; `prepare-beta.sh` now re-signs them inside-out with
Developer ID, hardened runtime, and a secure timestamp before packaging. The
native UI test and clean-install/device checks have not been run in this
preparation pass; unit tests alone do not establish those.

## One Apple setup step for Davis (done September 8)

Use the Apple Account associated with Developer team NB75Z9MVN9. In
[Apple Account](https://account.apple.com/), choose Sign-In and Security →
App-Specific Passwords and create **DO Beta Notarization**.

Run this in Terminal and follow the interactive prompts. Enter the generated
password into the secure Terminal prompt, not a chat message or source file.

```sh
xcrun notarytool store-credentials "DO-beta" --team-id NB75Z9MVN9
```

Apple validates and saves the credentials in Keychain. Tell Codex when this
succeeds. No certificate export or GitHub secret is needed for this local path.

References: [Apple password setup](https://support.apple.com/en-us/102654),
[Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

## Build and package

From the repository root:

```sh
bash macos/scripts/prepare-beta.sh 0.2.0 1
# After the Keychain profile is ready:
bash macos/scripts/prepare-beta.sh 0.2.0 1 DO-beta
```

The first command prepares a Developer ID signed candidate. The second submits
the app and DMG to Apple and checks their stapled tickets and Gatekeeper
acceptance. Output lives under `DerivedData/Beta/`. The installed app is not
replaced. A signed-only candidate is not a public installer.

## Focused acceptance — Davis and one independent tester

Use fictional notes. Export Library and Workspace tools separately first.
Record Pass/Fail and device/build beside each row; blanks are pending.

| Check | Expected result | Result |
| --- | --- | --- |
| Fresh Mac install and setup | Installs from notarized DMG; microphone and Accessibility setup completes; relaunch works. | |
| Mac dictation | Tap-to-record and hold-to-talk insert once in TextEdit; microphone stops; ordinary shortcuts remain usable. | |
| iPhone website and home-screen app | Sign in, connect your own Groq key, consent, record, save, reload, edit, and copy to Notes. | |
| Versions | Clean up a note, then restore its original without losing words. | |
| Recording interruption | Lose internet or background the phone; return and recover saved audio without duplicate notes. | |
| Backups | Export and reimport test notes; originals/versions survive; retrying import adds no duplicate set. Images require separate download. | |
| Pairing and text | Pair Mac and phone, compare confirmation codes, and send text both ways with Unicode and line breaks intact. | |
| Images | Send an actual image both ways and paste into an image-capable app. | |
| Reconnect and revoke | Pause/resume, disconnect/reconnect, then remove the pairing; removed devices cannot transfer. | |
| Independent account | A tester signs in with their own account and sees only their own notes, images, settings, and provider connection. | |

Automatic Mac Sync stays off for the first acceptance pass. Before recommending
automatic mode, test concurrent local copies and sleep/wake; stale transfers
must not replace a newer local clipboard.

Do not release with lost saved content, cross-account exposure, wrong-device
delivery, stale clipboard overwrite, repeated permission loops, or a failing
core capture/save flow. See the [full guide](manual-testing-guide.md) for detailed
reproduction steps. Cosmetics can be tracked for a later beta.

## Tester expectations

The website's recording and writing features require each tester's own Groq key
and cloud-processing consent. Their provider limits and charges apply. Mac
on-device dictation and clipboard Sync do not need a Groq key. Mac AI cleanup is
optional and has separate provider settings.

The Mac beta targets Apple Silicon and macOS 14+. iPhone uses the foreground
website/home-screen app. There is no native iPhone app or keyboard extension.
Cloud transcription requires internet. Pairing shares clipboard transfers;
native and website dictation histories are separate.

Testers can report issues at
https://github.com/Davisopp13/Dictation-Operative/issues with their device, version,
steps, expected result, and actual result. GitHub issues are public: use fictional
content and omit keys, pairing codes, and private screenshots.
