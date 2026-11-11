const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function newId(prefix: string): string {
  if (!/^[a-z][a-z0-9]*$/i.test(prefix)) throw new TypeError('Invalid ID prefix');
  return `${prefix}_${crypto.randomUUID()}`;
}

export function cleanText(value: string): string {
  return value.normalize('NFC').replace(CONTROL_CHARACTERS, '');
}

export function encodeCursor(value: Record<string, string | number>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function decodeCursor<T extends Record<string, string | number>>(cursor: string): T | null {
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function isAtLeastAge(birthDate: string, age: number, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date > now
  ) {
    return false;
  }
  let years = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day);
  if (beforeBirthday) years -= 1;
  return years >= age;
}

export function safeFilename(filename: string): string {
  return filename
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 120);
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return difference === 0;
}
