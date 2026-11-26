import { argon2id } from "hash-wasm";

export type Bytes = Uint8Array<ArrayBuffer>;

export interface KdfParams {
  salt: string;
  time_cost: number;
  memory_kib: number;
  parallelism: number;
}

export interface KdfPolicy {
  kdf_time_cost: number;
  kdf_memory_kib: number;
  kdf_parallelism: number;
}

export interface PasswordKeys {
  authKey: string;
  wrapKey: CryptoKey;
}

export interface VaultKeys {
  vaultKey: CryptoKey;
  privateKey: CryptoKey;
  publicKey: string;
}

export interface WrappedAccount {
  kdf: KdfParams;
  wrapped_vault_key: string;
  wrapped_private_key: string;
  public_key: string;
}

export class WrongSecretError extends Error {
  constructor() {
    super("Wrong password or corrupted data");
    this.name = "WrongSecretError";
  }
}

const MIN_MEMORY_KIB = 19456;
const MIN_TIME_COST = 2;

const AAD = {
  vaultKey: "ams/v2/vault-key",
  recoveryVaultKey: "ams/v2/vault-key/recovery",
  privateKey: "ams/v2/private-key",
  entry: (id: string) => `ams/v2/entry|${id}`,
  entryKey: (id: string, ownerId: string) => `ams/v2/entry-key|${id}|${ownerId}`,
  share: (id: string, ownerId: string, recipientId: string) => `ams/v2/share|${id}|${ownerId}|${recipientId}`,
};

const ECDH: EcKeyImportParams = { name: "ECDH", namedCurve: "P-256" };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Bytes {
  return new Uint8Array(encoder.encode(text));
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromB64(text: string): Bytes {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof WebAssembly !== "undefined";
}

function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function hkdf(secret: Bytes, info: string): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function seal(key: CryptoKey, plaintext: Bytes, aad: string): Promise<string> {
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8(aad) }, key, plaintext),
  );
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce);
  blob.set(ciphertext, nonce.length);
  return toB64(blob);
}

export async function open(key: CryptoKey, blob: string, aad: string): Promise<Bytes> {
  try {
    const raw = fromB64(blob);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: utf8(aad) },
      key,
      raw.subarray(12),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new WrongSecretError();
  }
}

export async function derivePasswordKeys(password: string, kdf: KdfParams): Promise<PasswordKeys> {
  if (kdf.memory_kib < MIN_MEMORY_KIB || kdf.time_cost < MIN_TIME_COST) {
    throw new Error("The server sent unsafe key-derivation settings. Sign-in was stopped.");
  }
  const master = new Uint8Array(
    await argon2id({
      password: password.normalize("NFKC"),
      salt: fromB64(kdf.salt),
      iterations: kdf.time_cost,
      memorySize: kdf.memory_kib,
      parallelism: kdf.parallelism,
      hashLength: 32,
      outputType: "binary",
    }),
  );
  try {
    const authKey = toB64(await hkdf(master, "ams/v2/auth"));
    const wrapKey = await importAesKey(await hkdf(master, "ams/v2/wrap"));
    return { authKey, wrapKey };
  } finally {
    master.fill(0);
  }
}

export function newKdfParams(policy: KdfPolicy): KdfParams {
  return {
    salt: toB64(randomBytes(16)),
    time_cost: policy.kdf_time_cost,
    memory_kib: policy.kdf_memory_kib,
    parallelism: policy.kdf_parallelism,
  };
}

const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_BYTES = 20;

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Bytes {
  const clean = text.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new WrongSecretError();
    value = ((value << 5) | index) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateRecoveryCode(): string {
  const groups = base32Encode(randomBytes(RECOVERY_BYTES)).match(/.{4}/g) ?? [];
  return groups.join("-");
}

export async function deriveRecoveryKeys(code: string): Promise<PasswordKeys> {
  const secret = base32Decode(code);
  if (secret.length !== RECOVERY_BYTES) throw new WrongSecretError();
  const authKey = toB64(await hkdf(secret, "ams/v2/recovery-auth"));
  const wrapKey = await importAesKey(await hkdf(secret, "ams/v2/recovery-wrap"));
  return { authKey, wrapKey };
}

export interface NewAccount extends WrappedAccount {
  auth_key: string;
  recovery_auth_key: string;
  recovery_wrapped_vault_key: string;
}

export async function createAccount(
  password: string,
  policy: KdfPolicy,
): Promise<{ account: NewAccount; recoveryCode: string }> {
  const kdf = newKdfParams(policy);
  const passwordKeys = await derivePasswordKeys(password, kdf);
  const vaultRaw = randomBytes(32);
  try {
    const vaultKey = await importAesKey(vaultRaw);
    const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
    const publicKey = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const privateRaw = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const recovery = await sealForRecovery(vaultRaw);
    return {
      recoveryCode: recovery.code,
      account: {
        kdf,
        auth_key: passwordKeys.authKey,
        wrapped_vault_key: await seal(passwordKeys.wrapKey, vaultRaw, AAD.vaultKey),
        public_key: publicKey,
        wrapped_private_key: await seal(vaultKey, privateRaw, AAD.privateKey),
        recovery_auth_key: recovery.recovery_auth_key,
        recovery_wrapped_vault_key: recovery.recovery_wrapped_vault_key,
      },
    };
  } finally {
    vaultRaw.fill(0);
  }
}

async function sealForRecovery(vaultRaw: Bytes) {
  const code = generateRecoveryCode();
  const keys = await deriveRecoveryKeys(code);
  return {
    code,
    recovery_auth_key: keys.authKey,
    recovery_wrapped_vault_key: await seal(keys.wrapKey, vaultRaw, AAD.recoveryVaultKey),
  };
}

async function keysFromVaultRaw(vaultRaw: Bytes, account: WrappedAccount): Promise<VaultKeys> {
  const vaultKey = await importAesKey(vaultRaw);
  const privateRaw = await open(vaultKey, account.wrapped_private_key, AAD.privateKey);
  try {
    const privateKey = await crypto.subtle.importKey("pkcs8", privateRaw, ECDH, false, ["deriveBits"]);
    return { vaultKey, privateKey, publicKey: account.public_key };
  } finally {
    privateRaw.fill(0);
  }
}

export async function unlockAccount(wrapKey: CryptoKey, account: WrappedAccount): Promise<VaultKeys> {
  const vaultRaw = await open(wrapKey, account.wrapped_vault_key, AAD.vaultKey);
  try {
    return await keysFromVaultRaw(vaultRaw, account);
  } finally {
    vaultRaw.fill(0);
  }
}

export async function changePassword(currentPassword: string, newPassword: string, account: WrappedAccount, policy: KdfPolicy) {
  const current = await derivePasswordKeys(currentPassword, account.kdf);
  const vaultRaw = await open(current.wrapKey, account.wrapped_vault_key, AAD.vaultKey);
  try {
    const kdf = newKdfParams(policy);
    const next = await derivePasswordKeys(newPassword, kdf);
    return {
      current_auth_key: current.authKey,
      kdf,
      auth_key: next.authKey,
      wrapped_vault_key: await seal(next.wrapKey, vaultRaw, AAD.vaultKey),
    };
  } finally {
    vaultRaw.fill(0);
  }
}

export async function proveCurrentPassword(password: string, account: WrappedAccount): Promise<string> {
  const keys = await derivePasswordKeys(password, account.kdf);
  (await open(keys.wrapKey, account.wrapped_vault_key, AAD.vaultKey)).fill(0);
  return keys.authKey;
}

export async function replaceRecoveryCode(currentPassword: string, account: WrappedAccount) {
  const current = await derivePasswordKeys(currentPassword, account.kdf);
  const vaultRaw = await open(current.wrapKey, account.wrapped_vault_key, AAD.vaultKey);
  try {
    const { code, ...material } = await sealForRecovery(vaultRaw);
    return { code, body: { current_auth_key: current.authKey, ...material } };
  } finally {
    vaultRaw.fill(0);
  }
}

export async function recoverAccount(
  recoveryCode: string,
  recoveryWrappedVaultKey: string,
  newPassword: string,
  policy: KdfPolicy,
) {
  const recoveryKeys = await deriveRecoveryKeys(recoveryCode);
  const vaultRaw = await open(recoveryKeys.wrapKey, recoveryWrappedVaultKey, AAD.recoveryVaultKey);
  try {
    const kdf = newKdfParams(policy);
    const next = await derivePasswordKeys(newPassword, kdf);
    const { code, ...newRecovery } = await sealForRecovery(vaultRaw);
    return {
      newRecoveryCode: code,
      body: {
        recovery_auth_key: recoveryKeys.authKey,
        kdf,
        auth_key: next.authKey,
        wrapped_vault_key: await seal(next.wrapKey, vaultRaw, AAD.vaultKey),
        new_recovery: newRecovery,
      },
    };
  } finally {
    vaultRaw.fill(0);
  }
}

async function sharedKey(privateKey: CryptoKey, otherPublicKey: string): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey("raw", fromB64(otherPublicKey), ECDH, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
  try {
    return await importAesKey(await hkdf(secret, "ams/v2/share"));
  } finally {
    secret.fill(0);
  }
}

export interface EntryLocator {
  id: string;
  ownerId: string;
}

export interface EntryAccess extends EntryLocator {
  wrappedKey: string;

  ownerPublicKey: string | null;
}

async function entryKeyRaw(keys: VaultKeys, entry: EntryAccess, myId: string): Promise<Bytes> {
  if (entry.ownerPublicKey === null) {
    return open(keys.vaultKey, entry.wrappedKey, AAD.entryKey(entry.id, entry.ownerId));
  }
  const key = await sharedKey(keys.privateKey, entry.ownerPublicKey);
  return open(key, entry.wrappedKey, AAD.share(entry.id, entry.ownerId, myId));
}

export async function decryptEntry(keys: VaultKeys, entry: EntryAccess, ciphertext: string, myId: string): Promise<string> {
  const raw = await entryKeyRaw(keys, entry, myId);
  try {
    return fromUtf8(await open(await importAesKey(raw), ciphertext, AAD.entry(entry.id)));
  } finally {
    raw.fill(0);
  }
}

export async function encryptEntryWithNewKey(keys: VaultKeys, entry: EntryLocator, plaintext: string) {
  const raw = randomBytes(32);
  try {
    return {
      ciphertext: await seal(await importAesKey(raw), utf8(plaintext), AAD.entry(entry.id)),
      wrapped_key: await seal(keys.vaultKey, raw, AAD.entryKey(entry.id, entry.ownerId)),

      wrapFor: (recipientId: string, recipientPublicKey: string) =>
        wrapEntryKey(keys, raw, entry, recipientId, recipientPublicKey),
      dispose: () => void raw.fill(0),
    };
  } catch (error) {
    raw.fill(0);
    throw error;
  }
}

export async function encryptEntry(keys: VaultKeys, entry: EntryAccess, plaintext: string, myId: string): Promise<string> {
  const raw = await entryKeyRaw(keys, entry, myId);
  try {
    return await seal(await importAesKey(raw), utf8(plaintext), AAD.entry(entry.id));
  } finally {
    raw.fill(0);
  }
}

async function wrapEntryKey(
  keys: VaultKeys,
  raw: Bytes,
  entry: EntryLocator,
  recipientId: string,
  recipientPublicKey: string,
): Promise<string> {
  const key = await sharedKey(keys.privateKey, recipientPublicKey);
  return seal(key, raw, AAD.share(entry.id, entry.ownerId, recipientId));
}

export async function shareEntryKey(
  keys: VaultKeys,
  entry: EntryAccess,
  recipientId: string,
  recipientPublicKey: string,
): Promise<string> {
  const raw = await entryKeyRaw(keys, entry, entry.ownerId);
  try {
    return await wrapEntryKey(keys, raw, entry, recipientId, recipientPublicKey);
  } finally {
    raw.fill(0);
  }
}

export async function fingerprint(publicKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", fromB64(publicKey)));
  const hex = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return (hex.toUpperCase().match(/.{4}/g) ?? []).join(" ");
}
