import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, ApiError, type SessionInfo } from "../src/lib/api";
import {
  changePassword,
  createAccount,
  derivePasswordKeys,
  deriveRecoveryKeys,
  proveCurrentPassword,
  recoverAccount,
  replaceRecoveryCode,
  unlockAccount,
  type VaultKeys,
} from "../src/lib/crypto";
import { analyseHealth, createEntry, EMPTY_ENTRY, loadEntries, rotateEntryKey, updateEntry } from "../src/lib/vault";
import { Browser, Server } from "./harness";

const server = new Server();
const browser = new Browser();
let password = "Test-harbor-violet-93-lantern";
let recoveryCode = "";
let session: SessionInfo;
let keys: VaultKeys;

async function unlock(): Promise<void> {
  browser.cookies.clear();
  const { kdf } = await api.status();
  const passwordKeys = await derivePasswordKeys(password, kdf!);
  session = await api.login(passwordKeys.authKey);
  keys = await unlockAccount(passwordKeys.wrapKey, session);
}

async function status(action: () => Promise<unknown>): Promise<number> {
  try {
    await action();
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}

const titles = async () => (await loadEntries(keys)).map((entry) => entry.data?.title ?? "(unreadable)");

beforeAll(async () => {
  await server.start({ AMS_NO_BROWSER: "1" });
  server.use(browser);
});
afterAll(() => server.stop());

describe("personal edition, end to end", () => {
  it("creates the vault once", async () => {
    const before = await api.status();
    expect(before.setup_required).toBe(true);
    const created = await createAccount(password, before.policy);
    recoveryCode = created.recoveryCode;
    await api.setup({ ...created.account, name: "Sam" });
    expect(await status(() => api.setup({ ...created.account, name: "Intruder" }))).toBe(409);
    expect((await api.status()).name).toBe("Sam");
  });

  it("unlocks only with the right master password", async () => {
    const { kdf } = await api.status();
    const wrong = await derivePasswordKeys("definitely not the password", kdf!);
    expect(await status(() => api.login(wrong.authKey))).toBe(401);
    expect(await status(() => api.credentials())).toBe(401);
    await unlock();
    expect(session.user.name).toBe("Sam");
  });

  it("stores entries encrypted and reads them back", async () => {
    await createEntry(keys, { ...EMPTY_ENTRY, title: "Home router", username: "admin", password: "abc123" });
    await createEntry(keys, { ...EMPTY_ENTRY, title: "Bank", password: "S3cure-Enough-Pass!", notes: "line 1\nline 2" });
    expect(await titles()).toEqual(["Bank", "Home router"]);

    const raw = JSON.stringify(await api.credentials());
    expect(raw).not.toContain("Home router");
    expect(raw).not.toContain("S3cure-Enough-Pass!");
    expect(server.file("vault.db")).not.toContain("Home router");
  });

  it("edits, re-keys and deletes entries, and rejects stale edits", async () => {
    const [bank, router] = await loadEntries(keys);
    await updateEntry(keys, router, { ...router.data!, password: "Much-Better-Router-Pass-1" });
    expect(await status(() => updateEntry(keys, router, { ...router.data!, notes: "old tab" }))).toBe(409);

    await rotateEntryKey(keys, bank);
    const after = await loadEntries(keys);
    expect(after.map((entry) => entry.data?.password)).toEqual(["S3cure-Enough-Pass!", "Much-Better-Router-Pass-1"]);
    expect(after[0].wrappedKey).not.toBe(bank.wrappedKey);
    expect(after[0].data?.notes).toBe("line 1\nline 2");

    const health = analyseHealth(after, session.policy.password_max_age_days);
    expect([...health.values()].some((entry) => entry.weak || entry.reused)).toBe(false);

    await api.deleteCredential(after[1].id);
    expect(await titles()).toEqual(["Bank"]);
  });

  it("keeps the vault after a password change", async () => {
    const next = "Brand-new-passphrase-2026";
    await api.changePassword(await changePassword(password, next, session, session.policy));
    expect(await status(unlock)).toBe(401);
    password = next;
    await unlock();
    expect(await titles()).toEqual(["Bank"]);
  });

  it("recovers a forgotten password with the recovery code, which is then replaced", async () => {
    browser.cookies.clear();
    const old = await deriveRecoveryKeys(recoveryCode);
    const started = await api.recoverStart(old.authKey);
    const recovered = await recoverAccount(recoveryCode, started.recovery_wrapped_vault_key, "Recovered-passphrase-9", started.policy);
    await api.recoverFinish(recovered.body);
    password = "Recovered-passphrase-9";
    await unlock();
    expect(await titles()).toEqual(["Bank"]);
    expect(await status(() => api.recoverStart(old.authKey))).toBe(401);

    const replaced = await replaceRecoveryCode(password, session);
    await api.replaceRecovery(replaced.body);
    expect(await status(async () => api.recoverStart((await deriveRecoveryKeys(recovered.newRecoveryCode)).authKey))).toBe(401);
    expect(await status(async () => api.recoverStart((await deriveRecoveryKeys(replaced.code)).authKey))).toBe(200);
  });

  it("saves preferences and records activity", async () => {
    const saved = await api.updatePreferences({ vault_timeout_minutes: 3 });
    expect(saved.vault_timeout_minutes).toBe(3);
    expect((await api.session()).policy.vault_timeout_minutes).toBe(3);
    expect(await status(() => api.updatePreferences({ kdf_memory_kib: 64 }))).toBe(422);

    const actions = (await api.activity()).map((row) => row.action);
    for (const expected of ["vault.created", "unlock.ok", "unlock.failed", "password.changed", "recovery.ok", "recovery_code.replaced"]) {
      expect(actions).toContain(expected);
    }
  });

  it("locks, and deleting the vault returns to first-run setup", async () => {
    await api.logout();
    expect(await status(() => api.credentials())).toBe(401);
    await unlock();
    expect(await status(() => api.deleteVault("A".repeat(43) + "="))).toBe(403);
    await api.deleteVault(await proveCurrentPassword(password, session));
    expect((await api.status()).setup_required).toBe(true);
  });
});
