import React, { useState } from "react";
import { bootstrapClaimApi, getCryptoConfigApi, loginMaterialApi, loginProofApi } from "../api";
import {
  deriveKeyFromPassword,
  generateX25519KeyPair,
  importAesKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
  randomBytes,
  toBase64,
  fromBase64,
  wrapPrivateKeyForLocalStorage,
  unwrapPrivateKeyFromLocalStorage,
} from "../crypto";
import { useAuth } from "../AuthContext";
import { toErrorMessage } from "../error";
import { DEFAULT_CRYPTO_CONFIG, toKdfParams } from "../cryptoConfig";

export default function BootstrapAdminForm({ onDone }: { onDone: () => void }) {
  const auth = useAuth();

  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // AQA NEA note: bootstrap uses same client-side key derivation/encryption flow as normal registration.
      const cryptoCfg = await getCryptoConfigApi().catch(() => DEFAULT_CRYPTO_CONFIG);
      const kdfParams = toKdfParams(cryptoCfg);
      const salt = randomBytes(16);
      const kdfKeyRaw = await deriveKeyFromPassword(masterPassword, salt, kdfParams);

      const rek = randomBytes(32);
      const kdfKey = await importAesKey(kdfKeyRaw);
      const rekEnc = await aesGcmEncrypt(kdfKey, rek);

      const { publicKey, privateKey } = generateX25519KeyPair();
      const blob = await wrapPrivateKeyForLocalStorage(privateKey, kdfKeyRaw);
      localStorage.setItem(`x25519_private_blob_pending:${username}`, blob);

      await bootstrapClaimApi({
        token,
        username,
        email,
        password_salt: toBase64(salt),
        password_verifier: toBase64(kdfKeyRaw),
        rek_ciphertext: toBase64(rekEnc.ciphertext),
        rek_nonce: toBase64(rekEnc.nonce),
        public_key: toBase64(publicKey),
      });

      const material = await loginMaterialApi(username);
      const salt2 = fromBase64(material.password_salt);
      const kdfKeyRaw2 = await deriveKeyFromPassword(masterPassword, salt2, kdfParams);
      const verifierProof = toBase64(kdfKeyRaw2);
      const res = await loginProofApi(username, verifierProof);

      const kdfKey2 = await importAesKey(kdfKeyRaw2);
      const rek2 = await aesGcmDecrypt(kdfKey2, fromBase64(material.rek_ciphertext), fromBase64(material.rek_nonce));

      // AQA NEA note: after bootstrap claim, remap pending private-key blob to stable user_id key.
      let blob2 = localStorage.getItem(`x25519_private_blob:${res.user.user_id}`);
      if (!blob2) blob2 = localStorage.getItem(`x25519_private_blob_pending:${username}`);
      if (!blob2) blob2 = localStorage.getItem("x25519_private_blob");

      if (!blob2) {
        setError("Missing local private key for this user in this browser. Register again for this user on this device.");
        return;
      }

      let xPriv: Uint8Array;
      try {
        xPriv = await unwrapPrivateKeyFromLocalStorage(blob2, kdfKeyRaw2);
      } catch {
        setError(
          "Could not decrypt the local private key. This usually means the wrong key blob for this account is stored on this device."
        );
        return;
      }

      localStorage.setItem(`x25519_private_blob:${res.user.user_id}`, blob2);
      localStorage.removeItem(`x25519_private_blob_pending:${username}`);
      if (localStorage.getItem("x25519_private_blob") === blob2) localStorage.removeItem("x25519_private_blob");

      const xPub = fromBase64(res.user.public_key);

      auth.setAuth({
        token: res.token,
        userId: res.user.user_id,
        username: res.user.username,
        email: res.user.email,
        isAdmin: res.user.is_admin,
        permissions: res.user.permissions,
        rek: rek2,
        x25519Private: xPriv,
        x25519Public: xPub,
      });

      onDone();
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onBootstrap} style={{ display: "grid", gap: 8, maxWidth: 460, width: "100%" }}>
      <h2 style={{ margin: "2px 0 6px" }}>Create Admin</h2>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bootstrap token" required />
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={masterPassword}
          onChange={(e) => {
            const next = e.target.value;
            setMasterPassword(next);
            if (!next) setShowMasterPassword(false);
          }}
          placeholder="Master password"
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
      <button type="submit" disabled={loading}>
        {loading ? "Creating..." : "Create admin"}
      </button>
      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}
    </form>
  );
}
