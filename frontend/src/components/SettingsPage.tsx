import { useState } from "react";
import {
  deleteMyAccountApi,
  getCryptoConfigApi,
  updateMyEmailApi,
  updateMyPasswordApi,
  updateMyUsernameApi,
} from "../api";
import { useAuth } from "../AuthContext";
import { useTranslation } from "../TranslationContext";
import { LANGUAGE_OPTIONS, type Lang } from "../translation";
import { aesGcmEncrypt, deriveKeyFromPassword, importAesKey, randomBytes, toBase64, wrapPrivateKeyForLocalStorage } from "../crypto";
import { evaluatePasswordStrength, generateStrongPassword } from "../password";
import { toErrorMessage } from "../error";
import { DEFAULT_CRYPTO_CONFIG, toKdfParams } from "../cryptoConfig";

export default function SettingsPage({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  const token = auth.token!;
  const { lang, setLang, t } = useTranslation();

  const canChangeUsername = auth.isAdmin || auth.permissions.can_change_username;
  const canChangeEmail = auth.isAdmin || auth.permissions.can_change_email;
  const canChangePassword = auth.isAdmin || auth.permissions.can_change_password;

  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordStrength = evaluatePasswordStrength(newPassword);
  const passwordStrengthLabel =
    passwordStrength.strength === "weak"
      ? t("password_strength_weak")
      : passwordStrength.strength === "medium"
      ? t("password_strength_medium")
      : t("password_strength_strong");

  async function changeEmail() {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      // AQA NEA note: account metadata updates are server-side; encrypted credential data is unchanged.
      await updateMyEmailApi(token, newEmail);
      auth.setAuth({
        token: auth.token,
        userId: auth.userId,
        username: auth.username,
        email: newEmail,
        isAdmin: auth.isAdmin,
        permissions: auth.permissions,
        rek: auth.rek,
        x25519Private: auth.x25519Private,
        x25519Public: auth.x25519Public,
      });
      setStatus(t("email_updated"));
      setNewEmail("");
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeUsername() {
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await updateMyUsernameApi(token, newUsername);
      auth.setAuth({
        token: auth.token,
        userId: auth.userId,
        username: newUsername,
        email: auth.email,
        isAdmin: auth.isAdmin,
        permissions: auth.permissions,
        rek: auth.rek,
        x25519Private: auth.x25519Private,
        x25519Public: auth.x25519Public,
      });
      setStatus(t("username_updated"));
      setNewUsername("");
    } catch (e: unknown) {
      const msg = toErrorMessage(e);
      if (msg.includes("Username already")) setError(t("username_already_taken"));
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    const ok = window.confirm(t("delete_confirm"));
    if (!ok) return;

    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      await deleteMyAccountApi(token);
      auth.logout();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
      setBusy(false);
    }
  }

  async function changePassword() {
    if (busy) return;
    if (!auth.rek || !auth.x25519Private || !auth.userId) return;
    if (newPassword !== confirmPassword) {
      setError(t("passwords_do_not_match"));
      return;
    }

    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const cryptoCfg = await getCryptoConfigApi().catch(() => DEFAULT_CRYPTO_CONFIG);
      const kdfParams = toKdfParams(cryptoCfg);
      const salt = randomBytes(16);
      // AQA NEA note: password change re-wraps existing REK with a newly derived key to preserve encrypted data access.
      const nextKeyRaw = await deriveKeyFromPassword(newPassword, salt, kdfParams);
      const nextKey = await importAesKey(nextKeyRaw);
      const rekEnc = await aesGcmEncrypt(nextKey, auth.rek);

      await updateMyPasswordApi(token, {
        password_salt: toBase64(salt),
        password_verifier: toBase64(nextKeyRaw),
        rek_ciphertext: toBase64(rekEnc.ciphertext),
        rek_nonce: toBase64(rekEnc.nonce),
      });

      const privateKeyBlob = await wrapPrivateKeyForLocalStorage(auth.x25519Private, nextKeyRaw);
      localStorage.setItem(`x25519_private_blob:${auth.userId}`, privateKeyBlob);
      if (auth.username) {
        localStorage.setItem(`x25519_private_blob_pending:${auth.username}`, privateKeyBlob);
      }

      setStatus(t("password_updated"));
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 700, padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("settings")}</h2>
        <button type="button" onClick={onBack} disabled={busy}>
          {t("back_to_dashboard")}
        </button>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 6 }}>
        <h3 style={{ margin: 0 }}>{t("your_details")}</h3>
        <div>
          <strong>{t("username")}:</strong> {auth.username ?? "Unknown"}
        </div>
        <div>
          <strong>{t("email")}:</strong> {auth.email ?? "Unknown"}
        </div>
        <div>
          <strong>{t("password")}:</strong> {t("password_hidden")}
        </div>
        <div>
          <strong>{t("account_type")}:</strong> {auth.isAdmin ? t("account_admin") : t("account_user")}
        </div>
        <div style={{ opacity: 0.8 }}>
          {t("permissions_line")}: {t("perm_username")}={String(auth.permissions.can_change_username)}, {t("perm_email")}=
          {String(auth.permissions.can_change_email)}, {t("perm_share")}={String(auth.permissions.can_share)}
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{t("language")}</h3>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          disabled={busy}
          style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{t("change_username")}</h3>
        <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t("new_username")} />
        <button type="button" onClick={changeUsername} disabled={busy || !newUsername.trim() || !canChangeUsername}>
          {t("update_username")}
        </button>
        {!canChangeUsername ? <div style={{ opacity: 0.75 }}>{t("disabled_by_admin")}</div> : null}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{t("change_email")}</h3>
        <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={t("new_email")} />
        <button type="button" onClick={changeEmail} disabled={busy || !newEmail.trim() || !canChangeEmail}>
          {t("update_email")}
        </button>
        {!canChangeEmail ? <div style={{ opacity: 0.75 }}>{t("disabled_by_admin")}</div> : null}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{t("change_password")}</h3>
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={t("new_password")}
          type="password"
        />
        <input
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder={t("confirm_new_password")}
          type="password"
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <small>
            {t("password_strength")}: {passwordStrengthLabel}
          </small>
          <button type="button" onClick={() => setNewPassword(generateStrongPassword(20))} disabled={busy || !canChangePassword}>
            {t("generate_password")}
          </button>
        </div>
        {passwordStrength.warning && newPassword.trim() ? <small style={{ color: "crimson" }}>{passwordStrength.warning}</small> : null}
        <button
          type="button"
          onClick={changePassword}
          disabled={busy || !newPassword.trim() || !confirmPassword.trim() || !canChangePassword}
        >
          {t("update_password")}
        </button>
        {!canChangePassword ? <div style={{ opacity: 0.75 }}>{t("disabled_by_admin")}</div> : null}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{t("delete_account")}</h3>
        <button type="button" onClick={deleteAccount} disabled={busy} style={{ color: "crimson" }}>
          {t("delete_account_button")}
        </button>
      </div>

      {status ? <div>{status}</div> : null}
      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
    </div>
  );
}
