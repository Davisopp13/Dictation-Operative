#!/bin/bash
# Build locally with Developer ID; optionally notarize using a Keychain profile.
# Usage: prepare-beta.sh VERSION BUILD [KEYCHAIN_PROFILE]
set -euo pipefail
umask 077

repo=$(cd "$(dirname "$0")/../.." && pwd)
version=${1:-}
build_number=${2:-}
profile=${3:-}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$build_number" =~ ^[1-9][0-9]*$ ]] || {
  echo 'Usage: prepare-beta.sh VERSION BUILD [KEYCHAIN_PROFILE]' >&2
  exit 1
}

identities=$(/usr/bin/security find-identity -v -p codesigning)
valid_ids=$(printf '%s\n' "$identities" | awk '/"Developer ID Application: / {print $2}')
count=$(printf '%s\n' "$valid_ids" | awk 'NF {n++} END {print n+0}')
[[ "$count" == 1 ]] || { echo 'Exactly one valid Developer ID Application identity is required.' >&2; exit 1; }
identity=$valid_ids
team=$(printf '%s\n' "$identities" | grep -Fi "$identity" | sed -E 's/.*\(([A-Z0-9]{10})\)"$/\1/')
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Cannot determine signing team.' >&2; exit 1; }

# Fail before building if a requested notarization profile is unavailable.
if [[ -n "$profile" ]]; then
  xcrun notarytool history --keychain-profile "$profile" >/dev/null
fi

xcodegen generate --spec "$repo/macos/project.yml" --project "$repo/macos"
xcodebuild -project "$repo/macos/Dictation.xcodeproj" -scheme Dictation \
  -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$repo/DerivedData" build \
  CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=$identity" "DEVELOPMENT_TEAM=$team" \
  OTHER_CODE_SIGN_FLAGS=--timestamp "MARKETING_VERSION=$version" \
  "CURRENT_PROJECT_VERSION=$build_number" SPARKLE_PUBLIC_ED_KEY= \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES

mkdir -p "$repo/DerivedData/Beta"
output=$(mktemp -d "$repo/DerivedData/Beta/$version-beta.$build_number.XXXXXX")
mkdir "$output/installer"
chmod 755 "$output/installer"
app="$output/installer/Dictation.app"
ditto "$repo/DerivedData/Build/Products/Release/Dictation.app" "$app"

# Xcode re-signs the embedded Sparkle framework but leaves its nested helpers
# ad-hoc signed, which notarization rejects. Re-sign inside-out with Developer ID,
# hardened runtime, and a secure timestamp (per Sparkle's signing docs), then
# re-seal the framework and the app, preserving the app's own entitlements.
sparkle="$app/Contents/Frameworks/Sparkle.framework"
for nested in \
  "$sparkle/Versions/B/XPCServices/Installer.xpc" \
  "$sparkle/Versions/B/XPCServices/Downloader.xpc" \
  "$sparkle/Versions/B/Autoupdate" \
  "$sparkle/Versions/B/Updater.app" \
  "$sparkle"; do
  codesign --force --sign "$identity" --options runtime --timestamp "$nested"
done
codesign --force --sign "$identity" --options runtime --timestamp \
  --preserve-metadata=entitlements "$app"
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv --verbose=4 "$app" 2> "$output/signature.txt"
grep -q '^Authority=Developer ID Application:' "$output/signature.txt"
grep -q 'flags=.*runtime' "$output/signature.txt"
lipo "$app/Contents/MacOS/Dictation" -verify_arch arm64
if codesign -d --entitlements :- "$app" 2>/dev/null | grep -q 'com.apple.security.get-task-allow'; then
  echo 'Release unexpectedly contains a debugging entitlement.' >&2
  exit 1
fi

cat > "$output/installer/READ ME.txt" <<EOF
Dictation Operative $version beta $build_number
Apple Silicon Mac, macOS 14 or later.

Quit any running Dictation app, then drag Dictation to Applications.
Open it and grant Microphone and Accessibility access when requested.
Download a speech model for dictation. Sync does not need a speech model.

Website: https://do-voice-workspace.davisopp.chatgpt.site/
The website requires sign-in and beta access. Voice/AI features use your own
Groq key; typed notes and clipboard Sync do not require a provider key.

This beta uses manual downloads for updates. Automatic updates are disabled.
Use Settings > Sync to pair devices and compare their confirmation codes.
Phone transfers require the website to be open and explicit Send/Receive.

Report bugs: https://github.com/Davisopp13/Dictation-Operative/issues
Use fictional examples; do not include API keys or pairing codes in reports.
EOF
chmod 644 "$output/installer/READ ME.txt"

if [[ -z "$profile" ]]; then
  echo "Signed beta prepared (not notarized; not ready for public download): $app"
  echo "To notarize and package, rerun with a Keychain profile as the third argument."
  exit 0
fi

notarize() {
  local target=$1
  local report=$2
  xcrun notarytool submit "$target" --keychain-profile "$profile" --wait --output-format json > "$report"
  if [[ "$(plutil -extract status raw -o - "$report")" != Accepted ]]; then
    echo "Apple did not accept this submission. Inspect $report before continuing." >&2
    return 1
  fi
}

ditto -c -k --keepParent "$app" "$output/Dictation-notarize.zip"
notarize "$output/Dictation-notarize.zip" "$output/app-notarization.json"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"

ln -s /Applications "$output/installer/Applications"
dmg="$output/Dictation-$version-beta.$build_number-arm64.dmg"
hdiutil create -volname 'Dictation Beta' -srcfolder "$output/installer" -format UDZO "$dmg"
codesign --sign "$identity" --timestamp "$dmg"
notarize "$dmg" "$output/dmg-notarization.json"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
(cd "$output" && shasum -a 256 "$(basename "$dmg")") > "$dmg.sha256"
echo "Notarized beta ready for release review: $dmg"
