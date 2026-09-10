import { AppError } from './domain';
function decode(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
async function key(secret: string) {
  if (!secret)
    throw new AppError('Secure connection storage is not configured yet.', 503);
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = decode(secret);
  } catch {
    throw new AppError('Secure connection storage is unavailable.', 503);
  }
  if (raw.length !== 32)
    throw new AppError('Secure connection storage is unavailable.', 503);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encryptCredential(
  value: string,
  secret: string,
  owner: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) },
    await key(secret),
    new TextEncoder().encode(value),
  );
  return encode(iv) + '.' + encode(new Uint8Array(encrypted));
}
export async function decryptCredential(
  value: string,
  secret: string,
  owner: string,
) {
  try {
    const [iv, data] = value.split('.');
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: decode(iv),
          additionalData: new TextEncoder().encode(owner),
        },
        await key(secret),
        decode(data),
      ),
    );
  } catch {
    throw new AppError(
      'Reconnect Groq in Settings to use recording and AI.',
      503,
    );
  }
}
