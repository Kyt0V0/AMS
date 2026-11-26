export type Strength = 0 | 1 | 2 | 3 | 4;

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

const COMMON = new Set([
  "password", "password1", "password123", "123456", "12345678", "123456789", "1234567890", "qwerty",
  "qwerty123", "letmein", "welcome", "welcome1", "admin", "admin123", "iloveyou", "monkey", "dragon",
  "football", "abc123", "111111", "changeme", "passw0rd", "p@ssw0rd", "secret", "master",
]);
const PATTERNS = /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv|pass|admin|(.)\2{2,})/i;

export interface GeneratorOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true };

function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % max;
}

export function generatePassword(options: GeneratorOptions = DEFAULT_GENERATOR): string {
  const sets = [
    options.lower ? LOWER : "",
    options.upper ? UPPER : "",
    options.digits ? DIGITS : "",
    options.symbols ? SYMBOLS : "",
  ].filter(Boolean);
  if (sets.length === 0) sets.push(LOWER);

  const length = Math.max(sets.length, Math.min(options.length, 128));
  const all = sets.join("");
  const chars = sets.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function passwordStrength(password: string): Strength {
  if (!password || COMMON.has(password.toLowerCase())) return 0;

  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 33;

  const unique = new Set(password).size;
  const effectiveLength = Math.min(password.length, unique * 2);
  let bits = effectiveLength * Math.log2(Math.max(pool, 2));
  if (PATTERNS.test(password)) bits *= 0.7;

  if (bits < 30) return 0;
  if (bits < 45) return 1;
  if (bits < 60) return 2;
  if (bits < 80) return 3;
  return 4;
}
