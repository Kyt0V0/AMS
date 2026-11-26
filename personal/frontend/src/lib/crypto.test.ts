import { describe, expect, it } from "vitest";
import {
  changePassword,
  createAccount,
  decryptEntry,
  derivePasswordKeys,
  deriveRecoveryKeys,
  encryptEntry,
  encryptEntryWithNewKey,
  fromB64,
  generateRecoveryCode,
  proveCurrentPassword,
  recoverAccount,
  replaceRecoveryCode,
  unlockAccount,
  WrongSecretError,
} from "./crypto";

const policy = { kdf_time_cost: 2, kdf_memory_kib: 19456, kdf_parallelism: 1 };

async function newVault(password: string) {
  const { account, recoveryCode } = await createAccount(password, policy);
  const keys = await unlockAccount((await derivePasswordKeys(password, account.kdf)).wrapKey, account);
  return { account, recoveryCode, keys };
}

describe("vault keys", () => {
  it("unlocks with the right password and nothing else", async () => {
    const { account } = await newVault("correct horse battery");
    const wrong = await derivePasswordKeys("correct horse batterx", account.kdf);
    await expect(unlockAccount(wrong.wrapKey, account)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(proveCurrentPassword("nope nope nope", account)).rejects.toBeInstanceOf(WrongSecretError);
    expect(await proveCurrentPassword("correct horse battery", account)).toBe(account.auth_key);
  });

  it("stores an auth key that is not the wrapping key", async () => {
    const { account } = await newVault("correct horse battery");
    const authAsKey = await crypto.subtle.importKey("raw", fromB64(account.auth_key), "AES-GCM", false, ["decrypt"]);
    await expect(unlockAccount(authAsKey, account)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("refuses unsafe key-derivation parameters", async () => {
    const { account } = await createAccount("some password 123", policy);
    await expect(derivePasswordKeys("x", { ...account.kdf, memory_kib: 64 })).rejects.toThrow(/unsafe/);
  });

  it("keeps the vault readable after a password change", async () => {
    const vault = await newVault("old password value");
    const sealed = await encryptEntryWithNewKey(vault.keys, "e1", "secret");
    const change = await changePassword("old password value", "new password value", vault.account, policy);
    const updated = { kdf: change.kdf, wrapped_vault_key: change.wrapped_vault_key };
    const keys = await unlockAccount((await derivePasswordKeys("new password value", updated.kdf)).wrapKey, updated);
    expect(await decryptEntry(keys, { id: "e1", wrappedKey: sealed.wrapped_key }, sealed.ciphertext)).toBe("secret");
    await expect(changePassword("wrong", "whatever else", vault.account, policy)).rejects.toBeInstanceOf(WrongSecretError);
  });
});

describe("recovery code", () => {
  it("tolerates sloppy typing and rejects short codes", async () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    const sloppy = await deriveRecoveryKeys(` ${code.toLowerCase().replace(/-/g, " ")} `);
    expect(sloppy.authKey).toBe((await deriveRecoveryKeys(code)).authKey);
    await expect(deriveRecoveryKeys("ABCD-EFGH")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("restores access with a new password and issues a new code", async () => {
    const vault = await newVault("forgotten password");
    const sealed = await encryptEntryWithNewKey(vault.keys, "e1", "still here");
    const recovered = await recoverAccount(vault.recoveryCode, vault.account.recovery_wrapped_vault_key, "brand new password", policy);
    expect(recovered.newRecoveryCode).not.toBe(vault.recoveryCode);
    const updated = { kdf: recovered.body.kdf, wrapped_vault_key: recovered.body.wrapped_vault_key };
    const keys = await unlockAccount((await derivePasswordKeys("brand new password", updated.kdf)).wrapKey, updated);
    expect(await decryptEntry(keys, { id: "e1", wrappedKey: sealed.wrapped_key }, sealed.ciphertext)).toBe("still here");
    await expect(
      recoverAccount(generateRecoveryCode(), vault.account.recovery_wrapped_vault_key, "x".repeat(12), policy),
    ).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("can be replaced while unlocked", async () => {
    const vault = await newVault("current password");
    const replaced = await replaceRecoveryCode("current password", vault.account);
    const again = await recoverAccount(replaced.code, replaced.body.recovery_wrapped_vault_key, "another password", policy);
    expect(again.body.recovery_auth_key).toBe(replaced.body.recovery_auth_key);
  });
});

describe("entries", () => {
  it("round-trips an entry and binds it to its id", async () => {
    const vault = await newVault("entry password 1");
    const sealed = await encryptEntryWithNewKey(vault.keys, "entry-1", JSON.stringify({ title: "Wi-Fi" }));
    const access = { id: "entry-1", wrappedKey: sealed.wrapped_key };
    expect(await decryptEntry(vault.keys, access, sealed.ciphertext)).toBe('{"title":"Wi-Fi"}');
    await expect(decryptEntry(vault.keys, { ...access, id: "entry-2" }, sealed.ciphertext)).rejects.toBeInstanceOf(WrongSecretError);

    const updated = await encryptEntry(vault.keys, access, "v2");
    expect(await decryptEntry(vault.keys, access, updated)).toBe("v2");
  });

  it("makes old ciphertext unreadable under a renewed key", async () => {
    const vault = await newVault("entry password 1");
    const first = await encryptEntryWithNewKey(vault.keys, "entry-1", "v1");
    const renewed = await encryptEntryWithNewKey(vault.keys, "entry-1", "v1");
    const access = { id: "entry-1", wrappedKey: renewed.wrapped_key };
    expect(await decryptEntry(vault.keys, access, renewed.ciphertext)).toBe("v1");
    await expect(decryptEntry(vault.keys, access, first.ciphertext)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("cannot be opened by a different vault", async () => {
    const mine = await newVault("my own password 1");
    const other = await newVault("someone elses pw 1");
    const sealed = await encryptEntryWithNewKey(mine.keys, "entry-1", "private");
    await expect(
      decryptEntry(other.keys, { id: "entry-1", wrappedKey: sealed.wrapped_key }, sealed.ciphertext),
    ).rejects.toBeInstanceOf(WrongSecretError);
  });
});
