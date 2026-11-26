import React, { useState } from "react";
import { getCryptoConfigApi, loginMaterialApi, loginProofApi, reportDecryptFailureApi } from "../api";
import { aesGcmDecrypt, deriveKeyFromPassword, fromBase64, importAesKey, toBase64, unwrapPrivateKeyFromLocalStorage } from "../crypto";
import { useAuth } from "../AuthContext";
import { useTranslation } from "../TranslationContext";
import { DEFAULT_CRYPTO_CONFIG, toKdfParams } from "../cryptoConfig";
import { toErrorMessage } from "../error";

export default function LoginForm() {
  const auth = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (busy) return;
    setBusy(true);

    try {
      const material = await loginMaterialApi(username);

      const salt = fromBase64(material.password_salt);
      const cryptoCfg = await getCryptoConfigApi().catch(() => DEFAULT_CRYPTO_CONFIG);
      const kdfParams = toKdfParams(cryptoCfg);

      // AQA NEA note: client derives verifier proof locally; master password is never sent to backend.
      const kdfKeyRaw = await deriveKeyFromPassword(masterPassword, salt, kdfParams);
      const kdfKey = await importAesKey(kdfKeyRaw);
      let rek: Uint8Array;
      try {
        // Local decrypt acts as password check before proof submission.
        rek = await aesGcmDecrypt(kdfKey, fromBase64(material.rek_ciphertext), fromBase64(material.rek_nonce));
      } catch {
        setError(t("incorrect_master_password"));
        return;
      }
      const verifierProof = toBase64(kdfKeyRaw);
      const res = await loginProofApi(username, verifierProof);

      // AQA NEA note: private key blob lookup supports both user_id and pending username keys for multi-account devices.
      let blob = localStorage.getItem(`x25519_private_blob:${res.user.user_id}`);
      if (!blob) blob = localStorage.getItem(`x25519_private_blob_pending:${username}`);
      if (!blob) blob = localStorage.getItem("x25519_private_blob");

      if (!blob) {
        setError(t("missing_local_private_key"));
        return;
      }

      let xPriv: Uint8Array;
      try {
        xPriv = await unwrapPrivateKeyFromLocalStorage(blob, kdfKeyRaw);
      } catch {
        try {
          await reportDecryptFailureApi(res.token, { stage: "login_private_key_unwrap_failed" });
        } catch {
          // Ignore logging failures so login UX still returns the original decryption error.
          void 0;
        }
        setError(t("wrong_local_private_key"));
        return;
      }

      localStorage.setItem(`x25519_private_blob:${res.user.user_id}`, blob);
      localStorage.removeItem(`x25519_private_blob_pending:${username}`);
      if (localStorage.getItem("x25519_private_blob") === blob) localStorage.removeItem("x25519_private_blob");

      const xPub = fromBase64(res.user.public_key);

      auth.setAuth({
        token: res.token,
        userId: res.user.user_id,
        username: res.user.username,
        email: res.user.email,
        isAdmin: res.user.is_admin,
        permissions: res.user.permissions,
        rek,
        x25519Private: xPriv,
        x25519Public: xPub,
      });
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <form onSubmit={onLogin} style={{ display: "grid", gap: 8, maxWidth: 460, width: "100%" }}>
      <h2 style={{ margin: "2px 0 6px" }}>{t("login")}</h2>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("username")} required />
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={masterPassword}
          onChange={(e) => {
            const next = e.target.value;
            setMasterPassword(next);
            if (!next) setShowMasterPassword(false);
          }}
          placeholder={t("master_password")}
          type={showMasterPassword ? "text" : "password"}
          required
          style={{ flex: 1 }}
        />
        {masterPassword.length > 0 ? (
          <button type="button" onClick={() => setShowMasterPassword((v) => !v)}>
            {showMasterPassword ? "Hide" : "Show"}
          </button>
        ) : null}
      </div>
      <button type="submit" disabled={busy}>{busy ? t("working") : t("login")}</button>
      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
    </form>
  );
}
