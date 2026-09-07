#!/bin/bash
# Build daily-use updates with the same Developer ID identity as distribution.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
identities=$(/usr/bin/security find-identity -v -p codesigning)
valid_ids=$(printf '%s\n' "$identities" | /usr/bin/awk '/"Developer ID Application: / {print $2}')
identity=${1:-}
if [[ -z "$identity" ]]; then
  count=$(printf '%s\n' "$valid_ids" | /usr/bin/awk 'NF {n++} END {print n+0}')
  [[ "$count" == 1 ]] || { echo 'Provide the SHA-1 identity from security find-identity -v -p codesigning; exactly one Developer ID Application identity is needed.' >&2; exit 1; }
  identity=$valid_ids
fi
[[ "$identity" =~ ^[A-Fa-f0-9]{40}$ ]] || { echo 'Expected a certificate SHA-1 identifier.' >&2; exit 1; }
printf '%s\n' "$valid_ids" | /usr/bin/grep -Fixq "$identity" || { echo 'That identity is not a valid Developer ID Application certificate on this Mac.' >&2; exit 1; }
team=$(printf '%s\n' "$identities" | /usr/bin/grep -Fi "$identity" | /usr/bin/sed -E 's/.*\(([A-Z0-9]{10})\)"$/\1/')
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Could not determine the signing team.' >&2; exit 1; }
xcodegen generate --spec "$repo/macos/project.yml" --project "$repo/macos"
xcodebuild -project "$repo/macos/Dictation.xcodeproj" -scheme Dictation \
  -configuration Release -destination 'platform=macOS' -derivedDataPath "$repo/DerivedData" \
  build CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=$identity" "DEVELOPMENT_TEAM=$team" \
  OTHER_CODE_SIGN_FLAGS=--timestamp
/usr/bin/codesign --verify --deep --strict "$repo/DerivedData/Build/Products/Release/Dictation.app"
echo "Signed build: $repo/DerivedData/Build/Products/Release/Dictation.app"
echo 'Quit the installed app, then run macos/scripts/install-app.sh with that path.'
