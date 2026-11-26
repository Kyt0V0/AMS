import { api, type ApiCredential, type ShareRecipient } from "./api";
import {
  decryptEntry,
  encryptEntry,
  encryptEntryWithNewKey,
  shareEntryKey,
  type EntryAccess,
  type VaultKeys,
} from "./crypto";
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
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  sharedWith: number;
  version: number;
  updatedAt: string;
  keyRotatedAt: string;
  wrappedKey: string;
  ownerPublicKey: string | null;

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

function access(entry: Pick<Entry, "id" | "ownerId" | "wrappedKey" | "ownerPublicKey">): EntryAccess {
  return { id: entry.id, ownerId: entry.ownerId, wrappedKey: entry.wrappedKey, ownerPublicKey: entry.ownerPublicKey };
}

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

async function toEntry(record: ApiCredential, keys: VaultKeys, myId: string): Promise<Entry> {
  const entry: Entry = {
    id: record.id,
    ownerId: record.owner_id,
    ownerName: record.owner_username,
    isOwner: record.is_owner,
    sharedWith: record.shared_with,
    version: record.version,
    updatedAt: record.updated_at,
    keyRotatedAt: record.key_rotated_at,
    wrappedKey: record.wrapped_key,
    ownerPublicKey: record.owner_public_key,
    data: null,
  };
  try {
    entry.data = parse(await decryptEntry(keys, access(entry), record.ciphertext, myId));
  } catch {
  }
  return entry;
}

export async function loadEntries(keys: VaultKeys, myId: string): Promise<Entry[]> {
  const records = await api.credentials();
  const entries = await Promise.all(records.map((record) => toEntry(record, keys, myId)));
  return entries.sort((a, b) => (a.data?.title ?? "").localeCompare(b.data?.title ?? "", undefined, { sensitivity: "base" }));
}

export async function createEntry(keys: VaultKeys, myId: string, data: EntryData): Promise<void> {
  const id = crypto.randomUUID();
  const stamped = { ...data, passwordChangedAt: new Date().toISOString() };
  const sealed = await encryptEntryWithNewKey(keys, { id, ownerId: myId }, JSON.stringify(stamped));
  sealed.dispose();
  await api.createCredential({ id, ciphertext: sealed.ciphertext, wrapped_key: sealed.wrapped_key });
}

export async function updateEntry(keys: VaultKeys, entry: Entry, data: EntryData): Promise<void> {
  const passwordChanged = data.password !== entry.data?.password;
  const stamped: EntryData = {
    ...data,
    passwordChangedAt: passwordChanged ? new Date().toISOString() : (entry.data?.passwordChangedAt ?? ""),
  };
  const ciphertext = await encryptEntry(keys, access(entry), JSON.stringify(stamped), entry.ownerId);
  await api.updateCredential(entry.id, { ciphertext, version: entry.version });
}

export async function shareEntry(keys: VaultKeys, entry: Entry, recipient: { id: string; public_key: string }): Promise<void> {
  const wrapped_key = await shareEntryKey(keys, access(entry), recipient.id, recipient.public_key);
  await api.share(entry.id, { recipient_id: recipient.id, wrapped_key });
}

export async function rotateEntryKey(keys: VaultKeys, entry: Entry, keep: ShareRecipient[]): Promise<void> {
  if (!entry.data) throw new Error("Entry is not readable");
  const sealed = await encryptEntryWithNewKey(keys, { id: entry.id, ownerId: entry.ownerId }, JSON.stringify(entry.data));
  try {
    const shares = await Promise.all(
      keep.map(async (recipient) => ({
        recipient_id: recipient.recipient_id,
        wrapped_key: await sealed.wrapFor(recipient.recipient_id, recipient.public_key),
      })),
    );
    await api.rotate(entry.id, {
      ciphertext: sealed.ciphertext,
      wrapped_key: sealed.wrapped_key,
      version: entry.version,
      shares,
    });
  } finally {
    sealed.dispose();
  }
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
