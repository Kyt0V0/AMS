import nacl from "tweetnacl";

export type KdfParams = {
  timeCost: number;
  memoryKib: number;
  parallelism: number;
  hashLen: number;
};

export const DEFAULT_KDF_PARAMS: KdfParams = {
  timeCost: 3,
  memoryKib: 65536,
  parallelism: 1,
  hashLen: 32,
};

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS
): Promise<Uint8Array> {
  // AQA NEA note: Argon2id runs client-side so the master password is never sent to the server.
  const a = window.argon2;
  if (!a || typeof a.hash !== "function") {
    throw new Error("argon2 not loaded. Check index.html and public/argon2-bundled.min.js");
  }

  const res = await a.hash({
    pass: password,
    salt,
    type: a.ArgonType && a.ArgonType.Argon2id ? a.ArgonType.Argon2id : 2,
    hashLen: params.hashLen,
    time: params.timeCost,
    mem: params.memoryKib,
    parallelism: params.parallelism,
  });

  return new Uint8Array(res.hash);
}

export async function importAesKey(raw32: Uint8Array): Promise<CryptoKey> {
  if (raw32.length !== 32) throw new Error("AES key must be 32 bytes");
  return crypto.subtle.importKey("raw", toArrayBuffer(raw32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce) }, key, toArrayBuffer(plaintext));
  return { ciphertext: new Uint8Array(ct), nonce };
}

export async function aesGcmDecrypt(key: CryptoKey, ciphertext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce) }, key, toArrayBuffer(ciphertext));
  return new Uint8Array(pt);
}

export function generateX25519KeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

export async function wrapPrivateKeyForLocalStorage(privateKey: Uint8Array, masterKeyRaw: Uint8Array): Promise<string> {
  const mk = await importAesKey(masterKeyRaw);
  const { ciphertext, nonce } = await aesGcmEncrypt(mk, privateKey);
  return JSON.stringify({ ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) });
}

export async function unwrapPrivateKeyFromLocalStorage(blob: string, masterKeyRaw: Uint8Array): Promise<Uint8Array> {
  const parsed = JSON.parse(blob) as { ciphertext: string; nonce: string };
  const mk = await importAesKey(masterKeyRaw);
  const pt = await aesGcmDecrypt(mk, fromBase64(parsed.ciphertext), fromBase64(parsed.nonce));
  return pt;
}

export async function encryptRecordKeyForUser(
  recordKeyRaw: Uint8Array,
  myPriv: Uint8Array,
  theirPub: Uint8Array
): Promise<{ cipher: Uint8Array; nonce: Uint8Array }> {
  // AQA NEA note: each share wraps the record key with an X25519-derived shared secret, so recipients get isolated key material.
  const shared = nacl.box.before(theirPub, myPriv);
  const sharedKey = await importAesKey(shared);
  const { ciphertext, nonce } = await aesGcmEncrypt(sharedKey, recordKeyRaw);
  return { cipher: ciphertext, nonce };
}

export async function decryptRecordKeyFromShare(
  cipher: Uint8Array,
  nonce: Uint8Array,
  myPriv: Uint8Array,
  theirPub: Uint8Array
): Promise<Uint8Array> {
  const shared = nacl.box.before(theirPub, myPriv);
  const sharedKey = await importAesKey(shared);
  return aesGcmDecrypt(sharedKey, cipher, nonce);
}
