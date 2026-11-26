import { useEffect, useMemo, useState } from "react";
import { createShareApi, listPublicUsersApi, listSharesForCredentialApi, revokeShareApi } from "../api";
import type { PublicUser, ShareRecipient } from "../api";
import { useAuth } from "../AuthContext";
import { encryptRecordKeyForUser, fromBase64, toBase64 } from "../crypto";
import { useTranslation } from "../TranslationContext";
import { toErrorMessage } from "../error";

export default function ShareModal({
  credentialId,
  recordKeyRaw,
  onClose,
  onShared,
}: {
  credentialId: string;
  recordKeyRaw: Uint8Array;
  onClose: () => void;
  onShared: () => void;
}) {
  const auth = useAuth();
  const { t } = useTranslation();

  const token = auth.token!;
  const myPriv = auth.x25519Private!;
  const myUserId = auth.userId!;

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentShares, setCurrentShares] = useState<ShareRecipient[]>([]);

  useEffect(() => {
    (async () => {
      try {
        // AQA NEA note: recipient list uses public key directory endpoint; private keys are never requested from server.
        const [list, shares] = await Promise.all([
          listPublicUsersApi(token),
          listSharesForCredentialApi(token, credentialId),
        ]);
        setUsers(list.filter((u) => u.user_id !== myUserId));
        setCurrentShares(shares);
      } catch (e: unknown) {
        setError(toErrorMessage(e));
      }
    })();
  }, [credentialId, myUserId, token]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, query]);

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = { ...prev };
      for (const u of filteredUsers) next[u.user_id] = true;
      return next;
    });
  }

  function clearAllSelected() {
    setSelected({});
  }

  async function shareNow() {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);

    try {
      const targets = users.filter((u) => selected[u.user_id]);
      if (targets.length === 0) {
        setError(t("select_at_least_one_user"));
        return;
      }

      for (const u of targets) {
        // AQA NEA note: each recipient receives their own encrypted copy of the record key.
        const theirPub = fromBase64(u.public_key);
        const enc = await encryptRecordKeyForUser(recordKeyRaw, myPriv, theirPub);

        await createShareApi(token, {
          credential_id: credentialId,
          to_user_id: u.user_id,
          shared_record_key_cipher: toBase64(enc.cipher),
          shared_nonce: toBase64(enc.nonce),
        });
      }

      setStatus(t("shared"));
      const shares = await listSharesForCredentialApi(token, credentialId);
      setCurrentShares(shares);
      onShared();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeNow(shareId: string) {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await revokeShareApi(token, shareId);
      const shares = await listSharesForCredentialApi(token, credentialId);
      setCurrentShares(shares);
      setStatus("Share revoked");
      onShared();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ background: "white", borderRadius: 12, padding: 16, width: "min(560px, 100%)", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("share")}</h3>
          <button onClick={onClose} disabled={busy}>
            {t("close")}
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_users")}
              disabled={busy}
              style={{ flex: 1, padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 240 }}
            />
            <button type="button" onClick={() => setQuery("")} disabled={busy || !query.trim()}>
              {t("clear_search")}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ opacity: 0.75 }}>
              {t("showing_users")} {filteredUsers.length} / {users.length} · {t("selected")} {selectedCount}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={selectAllFiltered} disabled={busy || filteredUsers.length === 0}>
                {t("select_all_shown")}
              </button>
              <button type="button" onClick={clearAllSelected} disabled={busy || selectedCount === 0}>
                {t("clear_selection")}
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 8,
            maxHeight: 260,
            overflow: "auto",
            border: "1px solid #eee",
            borderRadius: 8,
            padding: 8,
          }}
        >
          {filteredUsers.map((u) => (
            <label key={u.user_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!selected[u.user_id]}
                onChange={(e) => setSelected((prev) => ({ ...prev, [u.user_id]: e.target.checked }))}
                disabled={busy}
              />
              <span>{u.username}</span>
            </label>
          ))}
          {filteredUsers.length === 0 ? <div style={{ opacity: 0.75 }}>{t("no_matches")}</div> : null}
        </div>

        <button onClick={shareNow} disabled={busy}>
          {busy ? t("sharing") : t("share_selected_users")}
        </button>

        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 8, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{t("share_with")}</div>
          {currentShares.length === 0 ? (
            <div style={{ opacity: 0.75 }}>{t("not_shared_with_anyone")}</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {currentShares.map((s) => (
                <div key={s.share_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span>{s.to_username}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ opacity: 0.7 }}>{s.revoked ? t("revoked") : t("active")}</span>
                    {!s.revoked ? (
                      <button type="button" onClick={() => void revokeNow(s.share_id)} disabled={busy}>
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {status ? <div>{status}</div> : null}
        {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
      </div>
    </div>
  );
}
