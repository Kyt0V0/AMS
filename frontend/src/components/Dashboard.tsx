import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createShareApi,
  createCredentialApi,
  deleteCredentialApi,
  getCredentialApi,
  listCredentialsApi,
  listPublicUsersApi,
  listSharesForCredentialApi,
  reportDecryptFailureApi,
  revokeShareApi,
  rotateCredentialKeyApi,
  updateCredentialApi,
} from "../api";
import type { CredentialListItem, ShareRecipient } from "../api";
import { useAuth } from "../AuthContext";
import ShareModal from "./ShareModal";
import SettingsPage from "./SettingsPage";
import AdminPage from "./AdminPage";
import { useTranslation } from "../TranslationContext";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  decryptRecordKeyFromShare,
  encryptRecordKeyForUser,
  fromBase64,
  importAesKey,
  randomBytes,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../crypto";
import { evaluatePasswordStrength, generateStrongPassword } from "../password";
import { toErrorMessage } from "../error";

type PlainCredential = { username: string; password: string; notes: string };

export default function Dashboard() {
  const auth = useAuth();
  const { t } = useTranslation();

  const token = auth.token!;
  const rekRaw = auth.rek!;

  const [view, setView] = useState<"dashboard" | "credentials" | "settings" | "admin">("dashboard");

  const [items, setItems] = useState<CredentialListItem[]>([]);
  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedRecordKeyRaw, setSelectedRecordKeyRaw] = useState<Uint8Array | null>(null);

  const [shares, setShares] = useState<ShareRecipient[]>([]);
  const [showShare, setShowShare] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newSystemName, setNewSystemName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editSystemName, setEditSystemName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const newPasswordStrength = evaluatePasswordStrength(newPassword);
  const editPasswordStrength = evaluatePasswordStrength(editPassword);
  const newStrengthLabel =
    !newPassword.trim()
      ? "-"
      : newPasswordStrength.strength === "weak"
      ? t("password_strength_weak")
      : newPasswordStrength.strength === "medium"
      ? t("password_strength_medium")
      : t("password_strength_strong");
  const editStrengthLabel =
    !editPassword.trim()
      ? "-"
      : editPasswordStrength.strength === "weak"
      ? t("password_strength_weak")
      : editPasswordStrength.strength === "medium"
      ? t("password_strength_medium")
      : t("password_strength_strong");

  const refresh = useCallback(async () => {
    // Load latest credential metadata for dashboard cards and credential manager.
    setError(null);
    const list = await listCredentialsApi(token);
    setItems(list);
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => `${it.title} ${it.system_name}`.toLowerCase().includes(q));
  }, [items, query]);

  const rotationDueCount = useMemo(() => items.filter((item) => item.rotation_due).length, [items]);
  const sharedWithMeCount = useMemo(() => items.filter((item) => item.owner_user_id !== auth.userId).length, [items, auth.userId]);

  function resetSelection() {
    // Clears edit panel state when moving between records.
    setSelectedId(null);
    setSelectedOwnerId(null);
    setSelectedRecordKeyRaw(null);
    setShares([]);
    setEditTitle("");
    setEditSystemName("");
    setEditUsername("");
    setEditPassword("");
    setEditNotes("");
  }

  async function addCredential(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      // AQA NEA note: credentials are encrypted client-side with a per-record key before upload.
      const recordKeyRaw = randomBytes(32);
      const recordKey = await importAesKey(recordKeyRaw);

      const payload = utf8Encode(JSON.stringify({ username: newUsername, password: newPassword, notes: newNotes }));
      const encPayload = await aesGcmEncrypt(recordKey, payload);

      // AQA NEA note: per-record key is wrapped by the user's REK, so the backend stores only wrapped key material.
      const rekKey = await importAesKey(rekRaw);
      const encRecordKey = await aesGcmEncrypt(rekKey, recordKeyRaw);

      await createCredentialApi(token, {
        title: newTitle,
        system_name: newSystemName,
        password_ciphertext: toBase64(encPayload.ciphertext),
        data_nonce: toBase64(encPayload.nonce),
        record_key_ciphertext: toBase64(encRecordKey.ciphertext),
        record_key_nonce: toBase64(encRecordKey.nonce),
      });

      setNewTitle("");
      setNewSystemName("");
      setNewUsername("");
      setNewPassword("");
      setNewNotes("");
      setStatus(t("saved"));
      await refresh();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function selectCredential(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);

    setSelectedId(id);
    setSelectedRecordKeyRaw(null);
    setShares([]);

    try {
      const c = await getCredentialApi(token, id);

      setSelectedOwnerId(c.owner_user_id);
      setEditTitle(c.title);
      setEditSystemName(c.system_name);

      let recordKeyRaw: Uint8Array;

      if (c.owner_user_id === auth.userId) {
        // AQA NEA note: owner unwraps the record key locally using REK; plaintext never comes from the server.
        const rekKey = await importAesKey(rekRaw);
        recordKeyRaw = await aesGcmDecrypt(rekKey, fromBase64(c.record_key_ciphertext), fromBase64(c.record_key_nonce));
        const shareList = await listSharesForCredentialApi(token, id);
        setShares(shareList);
      } else {
        if (!c.share_bundle) throw new Error("Missing share bundle");
        // AQA NEA note: recipients derive a shared secret (X25519) locally to unwrap their shared record key copy.
        const sharerPub = fromBase64(c.share_bundle.from_public_key);
        recordKeyRaw = await decryptRecordKeyFromShare(
          fromBase64(c.share_bundle.shared_record_key_cipher),
          fromBase64(c.share_bundle.shared_nonce),
          auth.x25519Private!,
          sharerPub
        );
        setShares([]);
      }

      setSelectedRecordKeyRaw(recordKeyRaw);

      const recordKey = await importAesKey(recordKeyRaw);
      const pt = await aesGcmDecrypt(recordKey, fromBase64(c.password_ciphertext), fromBase64(c.data_nonce));
      const obj = JSON.parse(utf8Decode(pt)) as PlainCredential;

      setEditUsername(obj.username);
      setEditPassword(obj.password);
      setEditNotes(obj.notes);
    } catch (e: unknown) {
      const reason = toErrorMessage(e);
      try {
        await reportDecryptFailureApi(token, {
          stage: "credential_open_failed",
          credential_id: id,
          reason,
        });
      } catch {
        void 0;
      }
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdits() {
    if (busy) return;
    if (!selectedId || !selectedRecordKeyRaw) return;
    if (selectedOwnerId !== auth.userId) return;

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      // AQA NEA note: edits re-encrypt payload client-side; server only receives ciphertext + nonce updates.
      const payload = utf8Encode(JSON.stringify({ username: editUsername, password: editPassword, notes: editNotes }));
      const recordKey = await importAesKey(selectedRecordKeyRaw);
      const encPayload = await aesGcmEncrypt(recordKey, payload);

      await updateCredentialApi(token, selectedId, {
        title: editTitle,
        system_name: editSystemName,
        password_ciphertext: toBase64(encPayload.ciphertext),
        data_nonce: toBase64(encPayload.nonce),
      });

      setStatus(t("updated"));
      await refresh();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function rotateSelectedKey() {
    if (busy) return;
    if (!selectedId || !selectedRecordKeyRaw) return;
    if (selectedOwnerId !== auth.userId) return;

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const newRecordKeyRaw = randomBytes(32);
      const newRecordKey = await importAesKey(newRecordKeyRaw);
      const payload = utf8Encode(JSON.stringify({ username: editUsername, password: editPassword, notes: editNotes }));
      const encPayload = await aesGcmEncrypt(newRecordKey, payload);

      const rekKey = await importAesKey(rekRaw);
      const encRecordKey = await aesGcmEncrypt(rekKey, newRecordKeyRaw);

      await rotateCredentialKeyApi(token, selectedId, {
        password_ciphertext: toBase64(encPayload.ciphertext),
        data_nonce: toBase64(encPayload.nonce),
        record_key_ciphertext: toBase64(encRecordKey.ciphertext),
        record_key_nonce: toBase64(encRecordKey.nonce),
      });

      // AQA NEA note: after key rotation, active recipients receive an updated encrypted copy of the new record key.
      const activeShares = shares.filter((s) => !s.revoked);
      if (activeShares.length > 0) {
        const users = await listPublicUsersApi(token);
        const userById = new Map(users.map((u) => [u.user_id, u]));
        for (const s of activeShares) {
          const recipient = userById.get(s.to_user_id);
          if (!recipient) continue;
          const recipientPublicKey = fromBase64(recipient.public_key);
          const wrapped = await encryptRecordKeyForUser(newRecordKeyRaw, auth.x25519Private!, recipientPublicKey);
          await createShareApi(token, {
            credential_id: selectedId,
            to_user_id: s.to_user_id,
            shared_record_key_cipher: toBase64(wrapped.cipher),
            shared_nonce: toBase64(wrapped.nonce),
          });
        }
        const updatedShares = await listSharesForCredentialApi(token, selectedId);
        setShares(updatedShares);
      }

      setSelectedRecordKeyRaw(newRecordKeyRaw);
      setStatus("Credential key rotated");
      await refresh();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (busy) return;
    if (!selectedId) {
      setError("No credential selected.");
      return;
    }
    if (selectedOwnerId !== auth.userId) {
      setError("Only the credential owner can delete this item.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      await deleteCredentialApi(token, selectedId);
      resetSelection();
      setStatus(t("deleted"));
      await refresh();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openShare() {
    if (!selectedId || !selectedRecordKeyRaw) return;
    if (selectedOwnerId !== auth.userId) return;
    if (!auth.isAdmin && !auth.permissions.can_share) {
      setError(t("sharing_disabled_by_admin"));
      return;
    }
    setShowShare(true);
  }

  async function revokeShare(shareId: string) {
    if (busy) return;
    if (!selectedId) return;
    if (selectedOwnerId !== auth.userId) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await revokeShareApi(token, shareId);
      const shareList = await listSharesForCredentialApi(token, selectedId);
      setShares(shareList);
      setStatus("Share revoked");
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function renderDashboardHome() {
    const formatDate = (value?: string | null) => {
      if (!value) return "-";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return "-";
      return d.toLocaleString();
    };

    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{t("dashboard")}</h2>
            <div style={{ opacity: 0.75 }}>Overview of your credentials and access activity</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_credentials")}
              disabled={busy}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 260 }}
            />
            <button type="button" onClick={() => setView("credentials")} disabled={busy}>
              + Create Credential
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Total Credentials</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{items.length}</div>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Shared With Me</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{sharedWithMeCount}</div>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Pending Rotations</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{rotationDueCount}</div>
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: 10 }}>Title</th>
                <th style={{ padding: 10 }}>System</th>
                <th style={{ padding: 10 }}>Owner</th>
                <th style={{ padding: 10 }}>Last Updated</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((it) => (
                <tr key={it.credential_id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{it.title}</div>
                    {it.rotation_due ? <div style={{ color: "#a45100", fontSize: 12 }}>Rotation due</div> : null}
                  </td>
                  <td style={{ padding: 10 }}>{it.system_name}</td>
                  <td style={{ padding: 10 }}>{it.owner_user_id === auth.userId ? auth.username ?? "You" : "Shared"}</td>
                  <td style={{ padding: 10 }}>{formatDate(it.last_rotated_at)}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          await selectCredential(it.credential_id);
                          setView("credentials");
                        }}
                        disabled={busy}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await selectCredential(it.credential_id);
                          setView("credentials");
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredItems.length === 0 ? <div style={{ padding: 12, opacity: 0.75 }}>{t("no_matches")}</div> : null}
        </div>
      </div>
    );
  }

  function renderCredentialsManager() {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Credential Form</h2>
          <div style={{ opacity: 0.75 }}>Create or edit a credential</div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
          <form onSubmit={addCredential} style={{ display: "grid", gap: 8 }}>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder={t("title")} required />
            <input value={newSystemName} onChange={(e) => setNewSystemName(e.target.value)} placeholder={t("system_name")} required />
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t("username_field")} required />
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("password_field")} required />
              <button type="button" onClick={() => setNewPassword(generateStrongPassword(20))} disabled={busy}>
                {t("generate_password")}
              </button>
            </div>
            <small>
              {t("password_strength")}: {newStrengthLabel}
            </small>
            <textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder={t("notes")} rows={3} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={busy}>
                {busy ? t("working") : "Save Credential"}
              </button>
            </div>
          </form>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
          <h3 style={{ margin: 0 }}>{t("selected")}</h3>
          {selectedId ? (
            <div style={{ display: "grid", gap: 8 }}>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={t("title")} />
              <input value={editSystemName} onChange={(e) => setEditSystemName(e.target.value)} placeholder={t("system_name")} />
              <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder={t("username_field")} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                <input value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder={t("password_field")} />
                <button
                  type="button"
                  onClick={() => setEditPassword(generateStrongPassword(20))}
                  disabled={busy || selectedOwnerId !== auth.userId}
                >
                  {t("generate_password")}
                </button>
              </div>
              <small>
                {t("password_strength")}: {editStrengthLabel}
              </small>
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder={t("notes")} rows={3} />

              {selectedOwnerId === auth.userId ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={saveEdits} disabled={busy || !selectedRecordKeyRaw}>
                      {t("save_changes")}
                    </button>
                    <button type="button" onClick={deleteSelected} disabled={busy}>
                      {t("delete")}
                    </button>
                    <button type="button" onClick={rotateSelectedKey} disabled={busy || !selectedRecordKeyRaw}>
                      Rotate key
                    </button>
                    <button
                      type="button"
                      onClick={openShare}
                      disabled={busy || !selectedRecordKeyRaw || !(auth.isAdmin || auth.permissions.can_share)}
                    >
                      {t("share")}
                    </button>
                  </div>

                  <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("share_with")}</div>
                    {shares.length === 0 ? (
                      <div>{t("not_shared_with_anyone")}</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {shares.map((s) => (
                          <div key={s.share_id} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{s.to_username}</span>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ opacity: 0.7 }}>{s.revoked ? t("revoked") : t("active")}</span>
                              {!s.revoked ? (
                                <button type="button" onClick={() => void revokeShare(s.share_id)} disabled={busy}>
                                  Revoke
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>{t("view_only_no_edit")}</div>
              )}
            </div>
          ) : (
            <div style={{ opacity: 0.75 }}>{t("select_credential_hint")}</div>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: 10, borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>{t("credentials")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={refresh} disabled={busy}>
                {t("refresh")}
              </button>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: 10 }}>Title</th>
                <th style={{ padding: 10 }}>System</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.credential_id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{it.title}</div>
                    {it.rotation_due ? <div style={{ color: "#a45100", fontSize: 12 }}>Rotation due</div> : null}
                  </td>
                  <td style={{ padding: 10 }}>{it.system_name}</td>
                  <td style={{ padding: 10 }}>
                    <button type="button" onClick={() => void selectCredential(it.credential_id)} disabled={busy}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 ? <div style={{ padding: 12, opacity: 0.75 }}>{t("no_matches")}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", minHeight: "100vh" }}>
      <aside style={{ borderRight: "1px solid #ddd", padding: 16, display: "grid", alignContent: "start", gap: 8 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>{t("app_title")}</div>
        <button type="button" onClick={() => setView("dashboard")} disabled={busy || view === "dashboard"}>
          {t("dashboard")}
        </button>
        {auth.isAdmin ? (
          <button type="button" onClick={() => setView("admin")} disabled={busy || view === "admin"}>
            {t("admin")}
          </button>
        ) : null}
        <button type="button" onClick={() => setView("credentials")} disabled={busy || view === "credentials"}>
          {t("credentials")}
        </button>
        <button type="button" onClick={() => setView("settings")} disabled={busy || view === "settings"}>
          {t("settings")}
        </button>
        <button type="button" onClick={() => auth.logout()} disabled={busy}>
          {t("logout")}
        </button>
      </aside>

      <main style={{ padding: 24 }}>
        {view === "dashboard" ? renderDashboardHome() : null}
        {view === "credentials" ? renderCredentialsManager() : null}
        {view === "settings" ? <SettingsPage onBack={() => setView("dashboard")} /> : null}
        {view === "admin" ? <AdminPage onBack={() => setView("dashboard")} /> : null}

        {showShare && selectedId && selectedRecordKeyRaw ? (
          <ShareModal
            credentialId={selectedId}
            recordKeyRaw={selectedRecordKeyRaw}
            onClose={() => setShowShare(false)}
            onShared={async () => {
              setShowShare(false);
              try {
                const shareList = await listSharesForCredentialApi(token, selectedId);
                setShares(shareList);
              } catch (e: unknown) {
                setError(toErrorMessage(e));
              }
            }}
          />
        ) : null}

        {status ? <div style={{ marginTop: 12 }}>{status}</div> : null}
        {error ? <div style={{ marginTop: 12, color: "crimson" }}>{error}</div> : null}
      </main>
    </div>
  );
}
