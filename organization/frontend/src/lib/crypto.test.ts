import { describe, expect, it } from "vitest";
import {
  changePassword,
  createAccount,
  decryptEntry,
  derivePasswordKeys,
  deriveRecoveryKeys,
  encryptEntry,
  encryptEntryWithNewKey,
  fingerprint,
  fromB64,
  generateRecoveryCode,
  proveCurrentPassword,
  recoverAccount,
  replaceRecoveryCode,
  shareEntryKey,
  unlockAccount,
  WrongSecretError,
  type EntryAccess,
} from "./crypto";

const policy = { kdf_time_cost: 2, kdf_memory_kib: 19456, kdf_parallelism: 1 };

async function newUser(password: string) {
  const { account, recoveryCode } = await createAccount(password, policy);
  const keys = await unlockAccount((await derivePasswordKeys(password, account.kdf)).wrapKey, account);
  return { account, recoveryCode, keys };
}

describe("account keys", () => {
  it("unlocks with the right password and nothing else", async () => {
    const { account } = await newUser("correct horse battery");
    const wrong = await derivePasswordKeys("correct horse batterx", account.kdf);
    await expect(unlockAccount(wrong.wrapKey, account)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(proveCurrentPassword("nope nope nope", account)).rejects.toBeInstanceOf(WrongSecretError);
    expect(await proveCurrentPassword("correct horse battery", account)).toBe(account.auth_key);
  });

  it("sends the server an auth key that is not the wrapping key", async () => {
    const { account } = await newUser("correct horse battery");
    const authAsKey = await crypto.subtle.importKey("raw", fromB64(account.auth_key), "AES-GCM", false, ["decrypt"]);
    await expect(unlockAccount(authAsKey, account)).rejects.toBeInstanceOf(WrongSecretError);
    expect(fromB64(account.auth_key)).toHaveLength(32);
    expect(fromB64(account.public_key)).toHaveLength(65);
  });

  it("is deterministic per salt and different across salts", async () => {
    const a = await createAccount("same password here", policy);
    const b = await createAccount("same password here", policy);
    expect(a.account.auth_key).not.toBe(b.account.auth_key);
    expect((await derivePasswordKeys("same password here", a.account.kdf)).authKey).toBe(a.account.auth_key);
  });

  it("refuses unsafe key-derivation parameters", async () => {
    const { account } = await createAccount("some password 123", policy);
    await expect(derivePasswordKeys("x", { ...account.kdf, memory_kib: 64 })).rejects.toThrow(/unsafe/);
  });

  it("keeps the vault readable after a password change", async () => {
    const user = await newUser("old password value");
    const entry = { id: "e1", ownerId: "u1" };
    const sealed = await encryptEntryWithNewKey(user.keys, entry, "secret");
    sealed.dispose();

    const change = await changePassword("old password value", "new password value", user.account, policy);
    expect(change.current_auth_key).toBe(user.account.auth_key);
    const updated = { ...user.account, kdf: change.kdf, wrapped_vault_key: change.wrapped_vault_key };
    const next = await derivePasswordKeys("new password value", updated.kdf);
    expect(next.authKey).toBe(change.auth_key);
    const keys = await unlockAccount(next.wrapKey, updated);
    const access: EntryAccess = { ...entry, wrappedKey: sealed.wrapped_key, ownerPublicKey: null };
    expect(await decryptEntry(keys, access, sealed.ciphertext, "u1")).toBe("secret");

    await expect(changePassword("wrong", "whatever else", user.account, policy)).rejects.toBeInstanceOf(WrongSecretError);
  });
});

describe("recovery code", () => {
  it("has the expected shape and tolerates sloppy typing", async () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    const exact = await deriveRecoveryKeys(code);
    const sloppy = await deriveRecoveryKeys(` ${code.toLowerCase().replace(/-/g, " ")} `);
    expect(sloppy.authKey).toBe(exact.authKey);
    await expect(deriveRecoveryKeys("ABCD-EFGH")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("restores access with a new password and issues a new code", async () => {
    const user = await newUser("forgotten password");
    const recovered = await recoverAccount(
      user.recoveryCode,
      user.account.recovery_wrapped_vault_key,
      "brand new password",
      policy,
    );
    expect(recovered.body.recovery_auth_key).toBe(user.account.recovery_auth_key);
    expect(recovered.newRecoveryCode).not.toBe(user.recoveryCode);

    const updated = { ...user.account, kdf: recovered.body.kdf, wrapped_vault_key: recovered.body.wrapped_vault_key };
    const keys = await unlockAccount((await derivePasswordKeys("brand new password", updated.kdf)).wrapKey, updated);
    expect(keys.publicKey).toBe(user.account.public_key);

    const wrongCode = generateRecoveryCode();
    await expect(
      recoverAccount(wrongCode, user.account.recovery_wrapped_vault_key, "x".repeat(12), policy),
    ).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("can be replaced while signed in", async () => {
    const user = await newUser("current password");
    const replaced = await replaceRecoveryCode("current password", user.account);
    expect(replaced.body.current_auth_key).toBe(user.account.auth_key);
    const again = await recoverAccount(replaced.code, replaced.body.recovery_wrapped_vault_key, "another password", policy);
    expect(again.body.recovery_auth_key).toBe(replaced.body.recovery_auth_key);
  });
});

describe("entries and sharing", () => {
  it("round-trips an entry and binds it to its id", async () => {
    const alice = await newUser("alice password 1");
    const entry = { id: "entry-1", ownerId: "alice" };
    const sealed = await encryptEntryWithNewKey(alice.keys, entry, JSON.stringify({ title: "Wi-Fi" }));
    sealed.dispose();
    const access: EntryAccess = { ...entry, wrappedKey: sealed.wrapped_key, ownerPublicKey: null };

    expect(await decryptEntry(alice.keys, access, sealed.ciphertext, "alice")).toBe('{"title":"Wi-Fi"}');

    await expect(decryptEntry(alice.keys, { ...access, id: "entry-2" }, sealed.ciphertext, "alice")).rejects.toBeInstanceOf(
      WrongSecretError,
    );

    const updated = await encryptEntry(alice.keys, access, "v2", "alice");
    expect(updated).not.toBe(sealed.ciphertext);
    expect(await decryptEntry(alice.keys, access, updated, "alice")).toBe("v2");
  });

  it("lets only the intended recipient open a shared entry", async () => {
    const alice = await newUser("alice password 1");
    const bob = await newUser("bob password 123");
    const eve = await newUser("eve password 123");
    const entry = { id: "entry-1", ownerId: "alice" };
    const sealed = await encryptEntryWithNewKey(alice.keys, entry, "launch codes");
    sealed.dispose();
    const owned: EntryAccess = { ...entry, wrappedKey: sealed.wrapped_key, ownerPublicKey: null };

    const forBob = await shareEntryKey(alice.keys, owned, "bob", bob.account.public_key);
    const shared: EntryAccess = { ...entry, wrappedKey: forBob, ownerPublicKey: alice.account.public_key };

    expect(await decryptEntry(bob.keys, shared, sealed.ciphertext, "bob")).toBe("launch codes");
    await expect(decryptEntry(eve.keys, shared, sealed.ciphertext, "eve")).rejects.toBeInstanceOf(WrongSecretError);

    await expect(decryptEntry(bob.keys, shared, sealed.ciphertext, "eve")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("locks out a revoked recipient after key rotation", async () => {
    const alice = await newUser("alice password 1");
    const bob = await newUser("bob password 123");
    const carol = await newUser("carol password 1");
    const entry = { id: "entry-1", ownerId: "alice" };
    const first = await encryptEntryWithNewKey(alice.keys, entry, "v1");
    const bobOld = await first.wrapFor("bob", bob.account.public_key);
    first.dispose();

    const rotated = await encryptEntryWithNewKey(alice.keys, entry, "v2");
    const carolNew = await rotated.wrapFor("carol", carol.account.public_key);
    rotated.dispose();

    const alicePub = alice.account.public_key;
    const carolAccess: EntryAccess = { ...entry, wrappedKey: carolNew, ownerPublicKey: alicePub };
    const bobAccess: EntryAccess = { ...entry, wrappedKey: bobOld, ownerPublicKey: alicePub };
    expect(await decryptEntry(carol.keys, carolAccess, rotated.ciphertext, "carol")).toBe("v2");
    await expect(decryptEntry(bob.keys, bobAccess, rotated.ciphertext, "bob")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("produces a stable fingerprint", async () => {
    const { account } = await createAccount("fingerprint test", policy);
    expect(await fingerprint(account.public_key)).toMatch(/^([0-9A-F]{4} ){3}[0-9A-F]{4}$/);
    expect(await fingerprint(account.public_key)).toBe(await fingerprint(account.public_key));
  });
});
