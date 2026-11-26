import React, { useState } from "react";
import {
  aesGcmEncrypt,
  deriveKeyFromPassword,
  generateX25519KeyPair,
  importAesKey,
  randomBytes,
  toBase64,
  wrapPrivateKeyForLocalStorage,
} from "../crypto";
import { getCryptoConfigApi, registerUser } from "../api";
import { useTranslation } from "../TranslationContext";
import { evaluatePasswordStrength, generateStrongPassword } from "../password";
import { DEFAULT_CRYPTO_CONFIG, toKdfParams } from "../cryptoConfig";
import { toErrorMessage } from "../error";

export default function RegisterForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = evaluatePasswordStrength(masterPassword);
  const strengthLabel =
    strength.strength === "weak"
      ? t("password_strength_weak")
      : strength.strength === "medium"
      ? t("password_strength_medium")
      : t("password_strength_strong");

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setError(null);
    if (busy) return;
    setBusy(true);

    try {
      const cryptoCfg = await getCryptoConfigApi().catch(() => DEFAULT_CRYPTO_CONFIG);
      const kdfParams = toKdfParams(cryptoCfg);
      const salt = randomBytes(16);
      // AQA NEA note: derived key output is used as verifier and wrapping key; raw master password is never transmitted.
      const kdfKeyRaw = await deriveKeyFromPassword(masterPassword, salt, kdfParams);

      const rek = randomBytes(32);
      const kdfKey = await importAesKey(kdfKeyRaw);
      const rekEnc = await aesGcmEncrypt(kdfKey, rek);

      const { publicKey, privateKey } = generateX25519KeyPair();
      const blob = await wrapPrivateKeyForLocalStorage(privateKey, kdfKeyRaw);
      // AQA NEA note: pending key blob is namespaced by username so multiple local accounts do not overwrite each other before user_id is known.
      localStorage.setItem(`x25519_private_blob_pending:${username}`, blob);

      const reg = await registerUser({
        username,
        email,
        password_salt: toBase64(salt),
        password_verifier: toBase64(kdfKeyRaw),
        rek_ciphertext: toBase64(rekEnc.ciphertext),
        rek_nonce: toBase64(rekEnc.nonce),
        public_key: toBase64(publicKey),
      });

      localStorage.setItem(`x25519_private_blob:${reg.user_id}`, blob);

      setStatus(t("registered_you_can_login"));
      setUsername("");
      setEmail("");
      setMasterPassword("");
      onDone();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onRegister} style={{ display: "grid", gap: 8, maxWidth: 460, width: "100%" }}>
      <h2 style={{ margin: "2px 0 6px" }}>{t("register")}</h2>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("username")} required />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email")} required />
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <small>
          {t("password_strength")}: {strengthLabel}
        </small>
        <button type="button" onClick={() => setMasterPassword(generateStrongPassword(20))}>
          {t("generate_password")}
        </button>
      </div>
      {strength.warning && masterPassword.trim() ? <small style={{ color: "crimson" }}>{strength.warning}</small> : null}
      <button type="submit" disabled={busy}>{busy ? t("working") : t("create_account")}</button>
      {status ? <div>{status}</div> : null}
      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
    </form>
  );
}
