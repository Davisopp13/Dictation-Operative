# ADR-0003: XcodeGen project.yml, generated .xcodeproj gitignored

**Status:** accepted · **Date:** 2026-07-03

## Context

The project is developed partly from non-Mac environments, so the project definition must be authorable and reviewable as plain text. Options considered:

1. **Pure SwiftPM executable** — rejected. `swift build` yields a bare Mach-O, not an `.app` bundle. TCC attributes permissions to bundle ID + code signature: a bare binary has no proper `Info.plist` home for `NSMicrophoneUsageDescription` (the process is killed without it), loses Accessibility trust on every rebuild (ad-hoc signature churn), and can only fake `LSUIElement`. Fatal for an app whose core features are TCC-gated.
2. **Hand-written `.pbxproj`** — rejected. Opaque UUID graph, unvalidatable without Xcode; one bad reference and the project won't open.
3. **XcodeGen `project.yml`** — accepted. Deterministic YAML, supports SPM packages, generated Info.plist/entitlements, signing settings, and explicit schemes for CI.

## Decision

`macos/project.yml` is the source of truth; `*.xcodeproj` is gitignored. Developers run `xcodegen generate`; CI does the same before `xcodebuild`.

## Consequences

- One extra tool (`brew install xcodegen`) in the dev setup.
- No pbxproj merge conflicts, ever.
- Revisit (e.g. Tuist or a checked-in project) only if XcodeGen's feature ceiling is hit.
