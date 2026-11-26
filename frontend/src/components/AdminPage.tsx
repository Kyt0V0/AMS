import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminAuditApi,
  adminDbCredentialsApi,
  adminDbSharesApi,
  adminDbUsersApi,
  adminGetCryptoConfigApi,
  adminIntegrationStatusApi,
  adminListUsersApi,
  adminSetCryptoConfigApi,
  adminSetPermissionsApi,
  adminSetRoleApi,
} from "../api";
import type { AdminUser, AuditRow, CryptoConfig, DbCredentialRow, DbShareRow, DbUserRow, IntegrationStatus } from "../api";
import { useAuth } from "../AuthContext";
import { useTranslation } from "../TranslationContext";
import { toErrorMessage } from "../error";
import { DEFAULT_CRYPTO_CONFIG } from "../cryptoConfig";

type DbTab = "users" | "credentials" | "shares" | "audit";

async function fetchAllRows<T>(
  fetchPage: (page: { limit: number; offset: number }) => Promise<T[]>,
  limit: number = 500
): Promise<T[]> {
  // Helper to read full paginated admin datasets for audit/export views.
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const rows = await fetchPage({ limit, offset });
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

export default function AdminPage({ onBack }: { onBack: () => void }) {
  const PAGE_SIZE = 200;
  const auth = useAuth();
  const { t } = useTranslation();
  const token = auth.token!;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [allCreds, setAllCreds] = useState<DbCredentialRow[]>([]);
  const [allDbUsers, setAllDbUsers] = useState<DbUserRow[]>([]);
  const [allShares, setAllShares] = useState<DbShareRow[]>([]);
  const [credQuery, setCredQuery] = useState("");
  const [dbQuery, setDbQuery] = useState("");
  const [dbTab, setDbTab] = useState<DbTab>("users");
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [cryptoConfig, setCryptoConfig] = useState<CryptoConfig>(DEFAULT_CRYPTO_CONFIG);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    // Admin list endpoint returns decrypted usernames/emails for management tasks.
    setError(null);
    const list = await adminListUsersApi(token, { limit: PAGE_SIZE, offset: 0 });
    setUsers(list);
  }, [token]);

  const loadCreds = useCallback(async () => {
    const rows = await adminDbCredentialsApi(token, { limit: PAGE_SIZE, offset: 0 });
    setAllCreds(rows);
  }, [token]);

  const loadDbUsers = useCallback(async () => {
    const rows = await adminDbUsersApi(token, { limit: PAGE_SIZE, offset: 0 });
    setAllDbUsers(rows);
  }, [token]);

  const loadShares = useCallback(async () => {
    const rows = await adminDbSharesApi(token, { limit: PAGE_SIZE, offset: 0 });
    setAllShares(rows);
  }, [token]);

  const loadAudit = useCallback(async () => {
    const rows = await adminAuditApi(token, { limit: PAGE_SIZE, offset: 0 });
    setAuditRows(rows);
  }, [token]);

  const loadCryptoConfig = useCallback(async () => {
    const cfg = await adminGetCryptoConfigApi(token);
    setCryptoConfig(cfg);
  }, [token]);

  const loadIntegrationStatus = useCallback(async () => {
    const status = await adminIntegrationStatusApi(token);
    setIntegrationStatus(status);
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadUsers(), loadCreds(), loadDbUsers(), loadShares(), loadAudit(), loadCryptoConfig(), loadIntegrationStatus()]);
      } catch (e: unknown) {
        setError(toErrorMessage(e));
      }
    })();
  }, [loadAudit, loadCreds, loadCryptoConfig, loadDbUsers, loadIntegrationStatus, loadShares, loadUsers]);

  const decryptFailures = useMemo(
    () => auditRows.filter((row) => row.action_type === "DECRYPT_FAILURE"),
    [auditRows]
  );

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.username} ${u.email} ${u.user_id}`.toLowerCase().includes(q));
  }, [users, userQuery]);

  const selectedUser = useMemo(
    () => (selectedUserId ? users.find((u) => u.user_id === selectedUserId) ?? null : null),
    [users, selectedUserId]
  );

  const credsForSelectedUser = useMemo(() => {
    if (!selectedUserId) return [];
    const rows = allCreds.filter((c) => c.owner_user_id === selectedUserId);
    const q = credQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => `${c.title} ${c.system_name}`.toLowerCase().includes(q));
  }, [allCreds, selectedUserId, credQuery]);

  const filteredDbUsers = useMemo(() => {
    const q = dbQuery.trim().toLowerCase();
    if (!q) return allDbUsers;
    return allDbUsers.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [allDbUsers, dbQuery]);

  const filteredDbCreds = useMemo(() => {
    const q = dbQuery.trim().toLowerCase();
    if (!q) return allCreds;
    return allCreds.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [allCreds, dbQuery]);

  const filteredDbShares = useMemo(() => {
    const q = dbQuery.trim().toLowerCase();
    if (!q) return allShares;
    return allShares.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [allShares, dbQuery]);

  const filteredDbAudit = useMemo(() => {
    const q = dbQuery.trim().toLowerCase();
    if (!q) return auditRows;
    return auditRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [auditRows, dbQuery]);

  async function updateRole(u: AdminUser, role: "admin" | "editor" | "viewer") {
    if (busy) return;
    if (u.user_id === auth.userId && role !== "admin") {
      setError(t("cannot_change_own_admin"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await adminSetRoleApi(token, u.user_id, role);
      setStatus(t("updated"));
      await loadUsers();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCryptoConfig() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await adminSetCryptoConfigApi(token, cryptoConfig);
      setCryptoConfig(saved);
      setStatus("Crypto configuration updated");
      await loadAudit();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePerm(u: AdminUser, key: keyof AdminUser["permissions"]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await adminSetPermissionsApi(token, u.user_id, { [key]: !u.permissions[key] });
      setStatus(t("updated"));
      await loadUsers();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadCompleteDatabaseSnapshot() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // AQA NEA note: pagination loop allows admin to retrieve full SQLite table snapshots for verification screenshots.
      const [usersRows, credRows, shareRows, audit] = await Promise.all([
        fetchAllRows((page) => adminDbUsersApi(token, page)),
        fetchAllRows((page) => adminDbCredentialsApi(token, page)),
        fetchAllRows((page) => adminDbSharesApi(token, page)),
        fetchAllRows((page) => adminAuditApi(token, page)),
      ]);
      setAllDbUsers(usersRows);
      setAllCreds(credRows);
      setAllShares(shareRows);
      setAuditRows(audit);
      setStatus("Loaded full database snapshot");
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function exportSnapshotJson() {
    const payload = {
      users: allDbUsers,
      credentials: allCreds,
      shares: allShares,
      audit: auditRows,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ams_db_snapshot.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeRows = dbTab === "users" ? filteredDbUsers : dbTab === "credentials" ? filteredDbCreds : dbTab === "shares" ? filteredDbShares : filteredDbAudit;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1280, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>{t("admin_panel")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={async () => {
              try {
                setBusy(true);
                setError(null);
                await Promise.all([
                  loadUsers(),
                  loadCreds(),
                  loadDbUsers(),
                  loadShares(),
                  loadAudit(),
                  loadCryptoConfig(),
                  loadIntegrationStatus(),
                ]);
                setStatus(t("refreshed"));
              } catch (e: unknown) {
                setError(toErrorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            {t("refresh")}
          </button>
          <button type="button" onClick={onBack} disabled={busy}>
            {t("back_to_dashboard")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>{t("users")}</div>
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder={t("search_users_placeholder")}
              disabled={busy}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 260 }}
            />
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {filteredUsers.map((u) => (
              <button
                key={u.user_id}
                type="button"
                onClick={() => {
                  setSelectedUserId(u.user_id);
                  setCredQuery("");
                }}
                disabled={busy}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 8,
                  border: u.user_id === selectedUserId ? "2px solid #333" : "1px solid #eee",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600 }}>{u.username}</div>
                <div style={{ opacity: 0.75 }}>{u.email}</div>
                <div style={{ opacity: 0.6, fontSize: 12 }}>{u.user_id}</div>
              </button>
            ))}
            {filteredUsers.length === 0 ? <div style={{ opacity: 0.75 }}>{t("no_matches")}</div> : null}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600 }}>{t("selected_user")}</div>
            <input
              value={credQuery}
              onChange={(e) => setCredQuery(e.target.value)}
              placeholder={t("search_user_credentials_placeholder")}
              disabled={busy || !selectedUserId}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 260 }}
            />
          </div>

          {!selectedUser ? (
            <div style={{ marginTop: 12, opacity: 0.75 }}>{t("select_user_hint")}</div>
          ) : (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{selectedUser.username}</div>
                    <div style={{ opacity: 0.75 }}>{selectedUser.email}</div>
                    <div style={{ opacity: 0.6, fontSize: 12 }}>{selectedUser.user_id}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <select
                      value={selectedUser.role}
                      onChange={(e) => updateRole(selectedUser, e.target.value as "admin" | "editor" | "viewer")}
                      disabled={busy || selectedUser.user_id === auth.userId}
                    >
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>{t("permissions")}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedUser.permissions.can_change_username}
                        onChange={() => togglePerm(selectedUser, "can_change_username")}
                        disabled={busy || selectedUser.is_admin}
                      />
                      {t("change_username_label")}
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedUser.permissions.can_change_email}
                        onChange={() => togglePerm(selectedUser, "can_change_email")}
                        disabled={busy || selectedUser.is_admin}
                      />
                      {t("change_email_label")}
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedUser.permissions.can_change_password}
                        onChange={() => togglePerm(selectedUser, "can_change_password")}
                        disabled={busy || selectedUser.is_admin}
                      />
                      {t("change_password_label")}
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedUser.permissions.can_share}
                        onChange={() => togglePerm(selectedUser, "can_share")}
                        disabled={busy || selectedUser.is_admin}
                      />
                      {t("share_credentials_label")}
                    </label>
                  </div>
                  {selectedUser.is_admin ? <div style={{ opacity: 0.75 }}>{t("admins_bypass")}</div> : null}
                </div>
              </div>

              <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("credentials_metadata_only")}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {credsForSelectedUser.map((c) => (
                    <div key={c.credential_id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      <div style={{ opacity: 0.75 }}>{c.system_name}</div>
                      <div style={{ opacity: 0.6, fontSize: 12 }}>{c.credential_id}</div>
                    </div>
                  ))}
                  {credsForSelectedUser.length === 0 ? <div style={{ opacity: 0.75 }}>{t("no_matches")}</div> : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Crypto configuration</div>
        <label>
          Argon2 time cost
          <input
            type="number"
            value={cryptoConfig.argon2_time_cost}
            onChange={(e) => setCryptoConfig((s) => ({ ...s, argon2_time_cost: Number(e.target.value) }))}
            disabled={busy}
          />
        </label>
        <label>
          Argon2 memory (KiB)
          <input
            type="number"
            value={cryptoConfig.argon2_memory_kib}
            onChange={(e) => setCryptoConfig((s) => ({ ...s, argon2_memory_kib: Number(e.target.value) }))}
            disabled={busy}
          />
        </label>
        <label>
          Argon2 parallelism
          <input
            type="number"
            value={cryptoConfig.argon2_parallelism}
            onChange={(e) => setCryptoConfig((s) => ({ ...s, argon2_parallelism: Number(e.target.value) }))}
            disabled={busy}
          />
        </label>
        <label>
          Rotation due (days)
          <input
            type="number"
            value={cryptoConfig.credential_rotation_days}
            onChange={(e) => setCryptoConfig((s) => ({ ...s, credential_rotation_days: Number(e.target.value) }))}
            disabled={busy}
          />
        </label>
        <button type="button" onClick={saveCryptoConfig} disabled={busy}>
          Save crypto config
        </button>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600 }}>Internal integration status (placeholder)</div>
        <div style={{ opacity: 0.8, marginTop: 4 }}>
          {integrationStatus ? `${integrationStatus.provider}: ${integrationStatus.note}` : "Loading..."}
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600 }}>{t("decrypt_failures")}</div>
        <div style={{ opacity: 0.8, marginTop: 4 }}>
          {t("decrypt_failures_count")}: {decryptFailures.length}
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {decryptFailures.slice(0, 10).map((row) => (
            <div key={row.log_id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{row.timestamp}</div>
              <div style={{ fontSize: 12 }}>{row.details ?? "-"}</div>
            </div>
          ))}
          {decryptFailures.length === 0 ? <div style={{ opacity: 0.75 }}>{t("no_decrypt_failures")}</div> : null}
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600 }}>Database snapshot (admin)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={loadCompleteDatabaseSnapshot} disabled={busy}>
              Load full database snapshot
            </button>
            <button type="button" onClick={exportSnapshotJson} disabled={busy}>
              Export JSON
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setDbTab("users")} disabled={busy || dbTab === "users"}>
            Users
          </button>
          <button type="button" onClick={() => setDbTab("credentials")} disabled={busy || dbTab === "credentials"}>
            Credentials
          </button>
          <button type="button" onClick={() => setDbTab("shares")} disabled={busy || dbTab === "shares"}>
            Shares
          </button>
          <button type="button" onClick={() => setDbTab("audit")} disabled={busy || dbTab === "audit"}>
            Audit
          </button>
        </div>

        <input
          value={dbQuery}
          onChange={(e) => setDbQuery(e.target.value)}
          placeholder="Search in current table JSON..."
          disabled={busy}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        />

        <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8, display: "grid", gap: 8 }}>
          {activeRows.map((row, idx) => (
            <pre key={idx} style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#fafafa", padding: 8, borderRadius: 8 }}>
              {JSON.stringify(row, null, 2)}
            </pre>
          ))}
          {activeRows.length === 0 ? <div style={{ opacity: 0.75 }}>{t("no_matches")}</div> : null}
        </div>
      </div>

      {status ? <div>{status}</div> : null}
      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
    </div>
  );
}
