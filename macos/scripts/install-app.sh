#!/bin/bash
# Install a verified, consistently signed build. Never use this for ad-hoc previews.
set -euo pipefail
candidate=${1:?Usage: install-app.sh /path/to/Dictation.app}
destination=/Applications/Dictation.app
[[ "$candidate" != "$destination" && -d "$candidate" ]] || { echo 'Choose a built app outside /Applications.' >&2; exit 1; }
/usr/bin/codesign --verify --deep --strict "$candidate"
identity=$(/usr/bin/codesign -dv --verbose=4 "$candidate" 2>&1)
if ! printf '%s\n' "$identity" | /usr/bin/grep -q '^Authority='; then
  echo 'Refusing to install an ad-hoc build: every replacement can invalidate Accessibility approval. Sign with your stable Apple Development or Developer ID Application identity first.' >&2
  exit 1
fi
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist")
[[ "$bundle_id" == 'com.davisopp.Dictation' ]] || { echo 'Unexpected bundle identifier.' >&2; exit 1; }
if [[ -d "$destination" ]]; then
  previous=$(/usr/bin/codesign -dv --verbose=4 "$destination" 2>&1)
  if printf '%s\n' "$previous" | /usr/bin/grep -q '^Authority='; then
    requirement=$(/usr/bin/codesign -dr - "$destination" 2>&1 | /usr/bin/sed -n 's/^designated => //p')
    [[ -n "$requirement" ]] || { echo 'Cannot verify the installed identity.' >&2; exit 1; }
    /usr/bin/codesign --verify -R "=$requirement" "$candidate" || { echo 'Signing identity changed; refusing to replace the installed app.' >&2; exit 1; }
  else
    echo 'Transitioning from an ad-hoc build. macOS may need one fresh permission approval.'
  fi
fi
if /usr/bin/pgrep -f '^/Applications/Dictation.app/Contents/MacOS/Dictation$' >/dev/null; then
  echo 'Quit Dictation before installing so the running process matches the installed build.' >&2
  exit 1
fi
staging=$(/usr/bin/mktemp -d /Applications/.dictation-install.XXXXXX)
/usr/bin/ditto "$candidate" "$staging/Dictation.app"
/usr/bin/codesign --verify --deep --strict "$staging/Dictation.app"
if [[ -d "$destination" ]]; then
  backup="$staging/Previous-Dictation.app"
  /bin/mv "$destination" "$backup"
fi
if ! /bin/mv "$staging/Dictation.app" "$destination"; then
  if [[ -n "${backup:-}" ]]; then /bin/mv "$backup" "$destination"; fi
  echo "Installation failed; staging retained at $staging" >&2
  exit 1
fi
echo "Installed $destination. Previous build, if any, retained at $staging."
/usr/bin/open "$destination"
