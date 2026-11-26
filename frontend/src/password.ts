export type PasswordStrength = "weak" | "medium" | "strong";

export function evaluatePasswordStrength(password: string): {
  score: number;
  strength: PasswordStrength;
  warning: string | null;
} {
  let score = 0;

  if (password.length >= 12) score += 2;
  else if (password.length >= 8) score += 1;

  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (password.length < 8) {
    return { score, strength: "weak", warning: "Password is too short (minimum 8 characters)." };
  }
  if (score <= 3) {
    return { score, strength: "weak", warning: "Password is weak. Add length, numbers, and symbols." };
  }
  if (score <= 5) {
    return { score, strength: "medium", warning: "Password is acceptable, but could be stronger." };
  }
  return { score, strength: "strong", warning: null };
}

export function generateStrongPassword(length = 20): string {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{};:,.?";
  const all = lower + upper + digits + symbols;

  const required = [
    lower[Math.floor(Math.random() * lower.length)],
    upper[Math.floor(Math.random() * upper.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  const out = [...required];
  while (out.length < Math.max(length, 12)) {
    out.push(all[Math.floor(Math.random() * all.length)]);
  }

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}
