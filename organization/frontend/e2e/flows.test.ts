import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, ApiError, type LoginChallenge, type SessionInfo } from "../src/lib/api";
import {
  changePassword,
  createAccount,
  derivePasswordKeys,
  deriveRecoveryKeys,
  proveCurrentPassword,
  recoverAccount,
  unlockAccount,
  type VaultKeys,
} from "../src/lib/crypto";
import { createEntry, EMPTY_ENTRY, loadEntries, rotateEntryKey, shareEntry, updateEntry } from "../src/lib/vault";
import { Browser, Server } from "./harness";

const server = new Server();

class Person {
  browser = new Browser();
  session!: SessionInfo;
  keys!: VaultKeys;
  recoveryCode = "";

  constructor(
    readonly username: string,
    public password: string,
  ) {}

  get email() {
    return `${this.username}@example.test`;
  }

  get id() {
    return this.session.user.id;
  }

  act(): this {
    server.use(this.browser);
    return this;
  }

  async register(tokens: { setup_token?: string; invite_token?: string }) {
    this.act();
    const status = await api.status();
    const { account, recoveryCode } = await createAccount(this.password, status.policy);
    this.recoveryCode = recoveryCode;
    const body = { ...account, username: this.username, email: this.email };
    if (tokens.setup_token) await api.setup({ ...body, setup_token: tokens.setup_token });
    else await api.register({ ...body, invite_token: tokens.invite_token });
  }

  async signIn(): Promise<LoginChallenge | null> {
    this.act();
    this.browser.cookies.clear();
    const passwordKeys = await derivePasswordKeys(this.password, await api.prelogin(this.username));
    const result = await api.login(this.username, passwordKeys.authKey);
    if ("two_factor_required" in result) return result;
    this.session = result;
    this.keys = await unlockAccount(passwordKeys.wrapKey, result);
    return null;
  }

  async signInWithCode(): Promise<void> {
    const challenge = await this.signIn();
    if (!challenge) throw new Error("Expected a two-step challenge");
    const passwordKeys = await derivePasswordKeys(this.password, await api.prelogin(this.username));
    this.session = await api.loginVerify(challenge.ticket, await server.lastCode(this.email));
    this.keys = await unlockAccount(passwordKeys.wrapKey, this.session);
  }

  async entries() {
    this.act();
    return loadEntries(this.keys, this.id);
  }

  async titles() {
    return (await this.entries()).map((entry) => entry.data?.title ?? "(unreadable)");
  }
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

const alice = new Person("alice", "Test-harbor-violet-93-lantern");
const bob = new Person("bob", "Test-copper-meadow-47-signal");
const carol = new Person("carol", "Test-amber-quartz-58-harvest");

async function invite(person: Person, role: "admin" | "editor" | "viewer") {
  alice.act();
  const created = await api.adminCreateInvite({ label: person.username, role, expires_in_days: 1 });
  await person.register({ invite_token: created.token });
  await person.signIn();
}

beforeAll(() => server.start({ AMS_EMAIL_DEBUG: "1" }));
afterAll(() => server.stop());

describe("organization edition, end to end", () => {
  it("sets up the first administrator with the setup token", async () => {
    alice.act();
    expect((await api.status()).setup_required).toBe(true);
    expect((await api.localSetupToken()).token).toBe(server.file("setup-token.txt"));
    await alice.register({ setup_token: server.file("setup-token.txt") });
    expect(await alice.signIn()).toBeNull();
    expect(alice.session.user.role).toBe("admin");
    expect((await api.status()).setup_required).toBe(false);
  });

  it("stores entries that only their owner can read", async () => {
    alice.act();
    await createEntry(alice.keys, alice.id, { ...EMPTY_ENTRY, title: "Office Wi-Fi", username: "net", password: "S3cure-Enough-Pass!" });
    await createEntry(alice.keys, alice.id, { ...EMPTY_ENTRY, title: "Printer", password: "abc123" });
    expect(await alice.titles()).toEqual(["Office Wi-Fi", "Printer"]);

    const raw = await api.credentials();
    expect(JSON.stringify(raw)).not.toContain("Office Wi-Fi");
    expect(JSON.stringify(raw)).not.toContain("S3cure-Enough-Pass!");
  });

  it("lets invited people join with the role on their invitation", async () => {
    await invite(bob, "editor");
    await invite(carol, "viewer");
    expect(bob.session.user.role).toBe("editor");
    expect(carol.session.user.role).toBe("viewer");
    expect(await bob.titles()).toEqual([]);
    expect(await status(() => new Person("mallory", "Whatever-Long-Password-1").register({}))).toBe(403);
  });

  it("shares an entry so the recipient can decrypt it, read-only", async () => {
    const wifi = (await alice.entries()).find((entry) => entry.data?.title === "Office Wi-Fi")!;
    const directory = await api.directory();
    expect(directory.map((person) => person.username)).toEqual(["bob", "carol"]);
    for (const person of directory) await shareEntry(alice.keys, wifi, person);

    for (const reader of [bob, carol]) {
      const [seen] = await reader.entries();
      expect(seen.data?.password).toBe("S3cure-Enough-Pass!");
      expect(seen.isOwner).toBe(false);
      expect(seen.ownerName).toBe("alice");

      const refused = await status(() => api.updateCredential(seen.id, { ciphertext: "A".repeat(60), version: seen.version }));
      expect(refused).toBe(reader === carol ? 403 : 404);
    }
    expect((await alice.entries()).find((entry) => entry.id === wifi.id)!.sharedWith).toBe(2);
  });

  it("shows edits to everyone the entry is shared with, and rejects stale edits", async () => {
    const before = (await alice.entries()).find((entry) => entry.data?.title === "Office Wi-Fi")!;
    await updateEntry(alice.keys, before, { ...before.data!, password: "Changed-Pass-2026!" });
    expect((await bob.entries())[0].data?.password).toBe("Changed-Pass-2026!");

    alice.act();
    expect(await status(() => updateEntry(alice.keys, before, { ...before.data!, notes: "from an old tab" }))).toBe(409);
  });

  it("revoking re-keys the entry and locks the revoked person out", async () => {
    const wifi = (await alice.entries()).find((entry) => entry.data?.title === "Office Wi-Fi")!;
    const recipients = await api.shares(wifi.id);
    await rotateEntryKey(alice.keys, wifi, recipients.filter((recipient) => recipient.username !== "bob"));

    expect(await bob.titles()).toEqual([]);
    expect((await carol.entries())[0].data?.password).toBe("Changed-Pass-2026!");
    expect(await alice.titles()).toEqual(["Office Wi-Fi", "Printer"]);
  });

  it("enforces the role table: viewers cannot create, share or administer", async () => {
    carol.act();
    expect(await status(() => createEntry(carol.keys, carol.id, { ...EMPTY_ENTRY, title: "nope" }))).toBe(403);
    expect(await status(() => api.directory())).toBe(403);
    expect(await status(() => api.adminUsers())).toBe(403);
    bob.act();
    expect(await status(() => api.adminUsers())).toBe(403);
    await createEntry(bob.keys, bob.id, { ...EMPTY_ENTRY, title: "Bob's own", password: "Another-Long-Pass-77" });
    expect(await bob.titles()).toEqual(["Bob's own"]);
    expect(await alice.titles()).not.toContain("Bob's own");
  });

  it("keeps the vault after a password change and signs other devices out", async () => {
    const phone = new Person(bob.username, bob.password);
    await phone.signIn();

    bob.act();
    const newPassword = "Brand-new-passphrase-2026";
    await api.changePassword(await changePassword(bob.password, newPassword, bob.session, bob.session.policy));
    phone.act();
    expect(await status(() => api.session())).toBe(401);

    expect(await status(() => bob.signIn())).toBe(401);
    bob.password = newPassword;
    await bob.signIn();
    expect(await bob.titles()).toEqual(["Bob's own"]);
  });

  it("recovers a forgotten password with the recovery code", async () => {
    bob.act();
    bob.browser.cookies.clear();
    const recoveryKeys = await deriveRecoveryKeys(bob.recoveryCode);
    expect(await status(async () => api.recoverStart("bob", (await deriveRecoveryKeys(alice.recoveryCode)).authKey))).toBe(401);
    const started = await api.recoverStart("bob", recoveryKeys.authKey);
    const recovered = await recoverAccount(bob.recoveryCode, started.recovery_wrapped_vault_key, "Recovered-passphrase-9", started.policy);
    await api.recoverFinish({ username: "bob", ...recovered.body });

    bob.password = "Recovered-passphrase-9";
    await bob.signIn();
    expect(await bob.titles()).toEqual(["Bob's own"]);
    expect(await status(() => api.recoverStart("bob", recoveryKeys.authKey))).toBe(401);
  });

  it("two-step sign-in needs the e-mailed code", async () => {
    alice.act();
    expect((await api.startTwoFactor()).email_hint).toBe("a***@example.test");
    expect(await status(() => api.enableTwoFactor("000000"))).toBe(401);
    await api.enableTwoFactor(await server.lastCode(alice.email));

    const challenge = await alice.signIn();
    expect(challenge?.two_factor_required).toBe(true);
    expect(await status(() => api.session())).toBe(401);
    expect(await status(() => api.loginVerify(challenge!.ticket, "000000"))).toBe(401);

    const mailsBefore = server.mailCount();
    expect(await status(async () => api.login("alice", (await derivePasswordKeys("wrong password!!", await api.prelogin("alice"))).authKey))).toBe(401);
    expect(server.mailCount()).toBe(mailsBefore);

    await alice.signInWithCode();
    expect(await alice.titles()).toEqual(["Office Wi-Fi", "Printer"]);
  });

  it("an administrator can require two-step sign-in for everyone", async () => {
    alice.act();
    await api.adminUpdatePolicy({ require_two_factor: true });
    expect((await bob.signIn())?.email_hint).toBe("b***@example.test");
    await bob.signInWithCode();
    expect(await bob.titles()).toEqual(["Bob's own"]);
    alice.act();
    await api.adminUpdatePolicy({ require_two_factor: false });
    expect(await bob.signIn()).toBeNull();
  });

  it("a new e-mail address must be confirmed with a code sent to it", async () => {
    bob.act();
    expect(await status(() => api.updateProfile({ email: "robert@example.test" }))).toBe(409);
    const stranger = (await derivePasswordKeys("not bob's password", bob.session.kdf)).authKey;
    expect(await status(() => api.startEmailChange("robert@example.test", stranger))).toBe(403);
    const proof = await proveCurrentPassword(bob.password, bob.session);
    expect((await api.startEmailChange("robert@example.test", proof)).email_hint).toBe("r***@example.test");
    await api.confirmEmailChange(await server.lastCode("robert@example.test"));
    expect((await api.session()).user.email).toBe("robert@example.test");
  });

  it("administrators can disable and delete accounts, but not the last administrator", async () => {
    alice.act();
    expect(await status(() => api.adminUpdateUser(alice.id, { role: "editor" }))).toBe(409);
    await api.adminUpdateUser(carol.id, { is_active: false });
    carol.act();
    expect(await status(() => api.session())).toBe(401);
    expect(await status(() => carol.signIn())).toBe(403);

    alice.act();
    await api.adminDeleteUser(bob.id);
    expect((await api.adminUsers()).map((user) => user.username)).toEqual(["alice", "carol"]);
    const trail = await api.adminAudit({ limit: 200, offset: 0 });
    const actions = new Set(trail.items.map((row) => row.action));
    for (const expected of ["auth.setup", "credential.shared", "credential.unshared", "credential.key_rotated", "auth.recovered", "admin.user_deleted"]) {
      expect(actions).toContain(expected);
    }
  });
});
