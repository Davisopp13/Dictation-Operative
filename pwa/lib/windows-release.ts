// Immutable, reviewed prototype packages. Never accept an object key from a request.
export const WINDOWS_VERSION = '0.2.0';
export const windowsReleases = {
  x64: {
    filename: 'DO-HotkeyProbe-win-x64.zip',
    size: 49860578,
    sha256: '73b8814378250efed01a99855f0d6cf390c9c1ef0c9be2d8ca2d8b2df7f7a5b3',
  },
  arm64: {
    filename: 'DO-HotkeyProbe-win-arm64.zip',
    size: 47793142,
    sha256: 'a7a8c23c4ae8dae643cfc4e27a04483fa4f01a28dd14bf09770d0ddac6f434bd',
  },
} as const;

export function windowsRelease(architecture: string) {
  if (architecture !== 'x64' && architecture !== 'arm64') return null;
  const release = windowsReleases[architecture];
  return {
    ...release,
    key: `releases/windows/${WINDOWS_VERSION}/${release.sha256}/${release.filename}`,
  };
}
