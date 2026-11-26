import { api, type ApiCredential } from "./api";
import { decryptEntry, encryptEntry, encryptEntryWithNewKey, type VaultKeys } from "./crypto";
import { ageInDays } from "./dates";
import { passwordStrength } from "./password";

export interface EntryData {
  title: string;
  system: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  passwordChangedAt: string;
}

export interface Entry {
  id: string;
  version: number;
  updatedAt: string;
  keyRotatedAt: string;
  wrappedKey: string;

  data: EntryData | null;
}

export const EMPTY_ENTRY: EntryData = {
  title: "",
  system: "",
  username: "",
  password: "",
  url: "",
  notes: "",
  passwordChangedAt: "",
};

function parse(json: string): EntryData {
  const raw = JSON.parse(json) as Partial<EntryData>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    title: text(raw.title),
    system: text(raw.system),
    username: text(raw.username),
    password: text(raw.password),
    url: text(raw.url),
    notes: text(raw.notes),
    passwordChangedAt: text(raw.passwordChangedAt),
  };
}

async function toEntry(record: ApiCredential, keys: VaultKeys): Promise<Entry> {
  const entry: Entry = {
    id: record.id,
    version: record.version,
    updatedAt: record.updated_at,
    keyRotatedAt: record.key_rotated_at,
    wrappedKey: record.wrapped_key,
    data: null,
  };
  try {
    entry.data = parse(await decryptEntry(keys, entry, record.ciphertext));
  } catch {
  }
  return entry;
}

export async function loadEntries(keys: VaultKeys): Promise<Entry[]> {
  const records = await api.credentials();
  const entries = await Promise.all(records.map((record) => toEntry(record, keys)));
  return entries.sort((a, b) => (a.data?.title ?? "").localeCompare(b.data?.title ?? "", undefined, { sensitivity: "base" }));
}

export async function createEntry(keys: VaultKeys, data: EntryData): Promise<void> {
  const id = crypto.randomUUID();
  const stamped = { ...data, passwordChangedAt: new Date().toISOString() };
  const sealed = await encryptEntryWithNewKey(keys, id, JSON.stringify(stamped));
  await api.createCredential({ id, ...sealed });
}

export async function updateEntry(keys: VaultKeys, entry: Entry, data: EntryData): Promise<void> {
  const passwordChanged = data.password !== entry.data?.password;
  const stamped: EntryData = {
    ...data,
    passwordChangedAt: passwordChanged ? new Date().toISOString() : (entry.data?.passwordChangedAt ?? ""),
  };
  const ciphertext = await encryptEntry(keys, entry, JSON.stringify(stamped));
  await api.updateCredential(entry.id, { ciphertext, version: entry.version });
}

export async function rotateEntryKey(keys: VaultKeys, entry: Entry): Promise<void> {
  if (!entry.data) throw new Error("Entry is not readable");
  const sealed = await encryptEntryWithNewKey(keys, entry.id, JSON.stringify(entry.data));
  await api.rotate(entry.id, { ...sealed, version: entry.version });
}

export interface EntryHealth {
  weak: boolean;
  reused: boolean;
  old: boolean;
}

export function analyseHealth(entries: Entry[], maxAgeDays: number): Map<string, EntryHealth> {
  const uses = new Map<string, number>();
  for (const entry of entries) {
    const password = entry.data?.password;
    if (password) uses.set(password, (uses.get(password) ?? 0) + 1);
  }
  const health = new Map<string, EntryHealth>();
  for (const entry of entries) {
    const password = entry.data?.password ?? "";
    const age = ageInDays(entry.data?.passwordChangedAt ?? "");
    health.set(entry.id, {
      weak: password !== "" && passwordStrength(password) < 2,
      reused: password !== "" && (uses.get(password) ?? 0) > 1,
      old: password !== "" && age !== null && age >= maxAgeDays,
    });
  }
  return health;
}
