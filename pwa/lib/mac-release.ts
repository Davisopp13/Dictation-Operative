// The notarized beta is pinned by hash; newer local builds are not distributable
// until both the app and disk image have passed Apple's notarization checks.
export const MAC_VERSION = '0.2.0 beta 1';
export const macRelease = {
  filename: 'Dictation-0.2.0-beta.1-arm64.dmg',
  size: 6668547,
  sha256: 'c0e9f5d6905b764f2c0778f19429ae38215e425edf323ecf2cd3abe0e1f919b9',
} as const;

export const MAC_RELEASE_KEY = `releases/macos/0.2.0-beta.1/${macRelease.sha256}/${macRelease.filename}`;
