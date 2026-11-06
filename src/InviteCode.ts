import { createHash, randomInt } from 'node:crypto';

// 32 symbols with no 0/O or 1/I, so codes survive being read aloud or retyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A new random invite code: 16 symbols (80 bits), shown as four dash-separated groups,
 * e.g. `K7QM-3XPR-WD9A-H2TC`.
 */
export function generateInviteCode(): string {
  const symbols = Array.from({ length: 16 }, (): string => ALPHABET[randomInt(ALPHABET.length)]);
  return [ 0, 4, 8, 12 ].map((start): string => symbols.slice(start, start + 4).join('')).join('-');
}

/**
 * Canonical form of a code as typed by a person: upper case, without spaces or dashes.
 */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

/**
 * The storage key for a code. Only this hash is stored, so the stored data does not reveal usable codes.
 */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}
