# ADR-0006: Sparkle updates fed from GitHub Releases, built by a tag-triggered workflow

**Status:** accepted · **Date:** 2026-09-01

## Context

Phase 2 needs a real distribution path. Ad-hoc CI builds work for smoke tests but every replaced build gets a new code-signing identity, so macOS silently drops the Accessibility grant (see `permissions-and-distribution.md`). Daily use needs a stable Developer ID identity, notarization so Gatekeeper opens the app without a right-click dance, and in-app updates so we stop re-downloading zips.

Options for hosting the update feed: a `gh-pages` branch, an S3 bucket, or the release itself.

## Decision

- **Sparkle 2** (SPM) for updates. `UpdaterService` is the isolation file; the updater only starts when the build carries `SUPublicEDKey`, so dev/CI builds never check for updates and hide the menu item.
- **The appcast is a release asset.** `SUFeedURL` is `https://github.com/<owner>/<repo>/releases/latest/download/appcast.xml`. GitHub's `latest` redirect always resolves to the newest non-prerelease, non-draft release, so publishing a release *is* publishing the update. No extra branch or bucket to keep in sync; each appcast describes exactly one version, which is all Sparkle needs without delta updates.
- **One workflow, triggered by a `vX.Y.Z` tag** (`.github/workflows/release.yml`): sign with Developer ID under hardened runtime, notarize + staple the app, build a DMG, sign + notarize + staple the DMG, run Sparkle's `generate_appcast` with the private EdDSA key, and publish DMG + appcast via a GitHub release.
- Versions come from the tag (`MARKETING_VERSION`) and the workflow run number (`CURRENT_PROJECT_VERSION`), injected as build settings; `project.yml` references them from Info.plist.
- Secrets stay in GitHub Actions secrets; the Sparkle private key never touches the repo. The public key is a repository *variable* so it is auditable.

## Consequences

- Releasing is `git tag v0.2.0 && git push origin v0.2.0`. Roughly 10 minutes later the update is live.
- Requires a paid Apple Developer account for the Developer ID certificate and notarization; without the secrets the workflow fails fast at its configuration check.
- Pre-releases (marked as such on GitHub) are ignored by `latest`, which gives us a free beta channel later if we want one.
- Existing ad-hoc builds cannot update themselves to a Developer ID build (different signing identity; Sparkle refuses). One manual DMG install is needed to get onto the update track.
