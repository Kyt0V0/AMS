const API_BASE_STORAGE_KEY = "ams_api_base";
export const DEFAULT_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8000";

function normalizeBase(base: string): string {
  return base.trim().replace(/\/$/, "");
}

function localFallbackBases(saved: string): string[] {
  const normalizedSaved = normalizeBase(saved);
  const candidates = [
    normalizedSaved,
    normalizeBase(DEFAULT_API_BASE),
    "http://127.0.0.1:8000",
    "http://localhost:8000",
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("load failed") || msg.includes("networkerror");
}

async function fetchWithLocalFallback(path: string, init?: RequestInit): Promise<Response> {
  const saved = getApiBase();
  const bases = localFallbackBases(saved);
  let lastErr: unknown = null;

  for (const base of bases) {
    try {
      const resp = await fetch(`${base}${path}`, init);
      if (base !== saved && resp.ok) {
        // AQA NEA note: if fallback succeeds, persist the working backend URL for future requests.
        setApiBase(base);
      }
      return resp;
    } catch (err: unknown) {
      lastErr = err;
      if (!isNetworkError(err)) throw err;
    }
  }

  if (lastErr) throw lastErr;
  throw new Error("Backend request failed");
}

export function getApiBase(): string {
  // AQA NEA note: API endpoint can be overridden per device for internal network deployment.
  if (typeof window === "undefined") return DEFAULT_API_BASE;
  const saved = localStorage.getItem(API_BASE_STORAGE_KEY)?.trim();
  return normalizeBase(saved || DEFAULT_API_BASE);
}

export function setApiBase(next: string): void {
  if (typeof window === "undefined") return;
  const cleaned = normalizeBase(next);
  if (!cleaned) localStorage.removeItem(API_BASE_STORAGE_KEY);
  else localStorage.setItem(API_BASE_STORAGE_KEY, cleaned);
}

const DEFAULT_PAGE_SIZE = 100;

function withPagination(base: string, page?: PaginationOptions): string {
  const limit = page?.limit ?? DEFAULT_PAGE_SIZE;
  const offset = page?.offset ?? 0;
  return `${base}?limit=${limit}&offset=${offset}`;
}

export type PaginationOptions = {
  limit?: number;
  offset?: number;
};

export type RegisterBody = {
  username: string;
  email: string;
  password_salt: string;
  password_verifier: string;
  rek_ciphertext: string;
  rek_nonce: string;
  public_key: string;
};

export type LoginResponse = {
  success: boolean;
  token: string;
  token_expires_at: string;
  user: {
    user_id: string;
    username: string;
    email: string;
    password_salt: string;
    password_verifier: string;
    rek_ciphertext: string;
    rek_nonce: string;
    public_key: string;
    preferred_language?: string | null;
    is_admin: boolean;
    role: "admin" | "editor" | "viewer";
    permissions: {
      can_change_username: boolean;
      can_change_email: boolean;
      can_change_password: boolean;
      can_share: boolean;
    };
  };
};

export type LoginMaterialResponse = {
  success: boolean;
  user_id: string;
  username: string;
  email: string;
  password_salt: string;
  rek_ciphertext: string;
  rek_nonce: string;
  public_key: string;
  preferred_language?: string | null;
};

export type AdminUser = {
  user_id: string;
  username: string;
  email: string;
  is_admin: boolean;
  role: "admin" | "editor" | "viewer";
  permissions: {
    can_change_username: boolean;
    can_change_email: boolean;
    can_change_password: boolean;
    can_share: boolean;
  };
  created_at?: string | null;
  last_login?: string | null;
};

export type AuditRow = {
  log_id: string;
  user_id?: string | null;
  action_type: string;
  target_id?: string | null;
  details?: string | null;
  timestamp: string;
};

export type DbCredentialRow = {
  credential_id: string;
  owner_user_id: string;
  title: string;
  system_name: string;
  created_at?: string;
  password_ciphertext?: string;
  data_nonce?: string;
  record_key_ciphertext?: string;
  record_key_nonce?: string;
  last_rotated_at?: string | null;
};

export type DbUserRow = {
  user_id: string;
  username_hash: string;
  username_ciphertext: string;
  username_nonce: string;
  email_hash: string;
  email_ciphertext: string;
  email_nonce: string;
  password_salt: string;
  password_verifier: string;
  rek_ciphertext: string;
  rek_nonce: string;
  public_key: string;
  role: "admin" | "editor" | "viewer";
  is_admin: boolean;
  can_change_username: boolean;
  can_change_email: boolean;
  can_change_password: boolean;
  can_share: boolean;
  created_at?: string | null;
  last_login?: string | null;
};

export type DbShareRow = {
  share_id: string;
  credential_id: string;
  from_user_id: string;
  to_user_id: string;
  shared_record_key_cipher: string;
  shared_nonce: string;
  revoked: boolean;
  created_at?: string | null;
  revoked_at?: string | null;
};

export type CredentialListItem = {
  credential_id: string;
  owner_user_id: string;
  title: string;
  system_name: string;
  last_rotated_at?: string | null;
  rotation_due?: boolean;
};

export type CredentialOut = {
  credential_id: string;
  owner_user_id: string;
  title: string;
  system_name: string;
  password_ciphertext: string;
  data_nonce: string;
  record_key_ciphertext: string;
  record_key_nonce: string;
  last_rotated_at?: string | null;
  share_bundle?: {
    from_user_id: string;
    from_public_key: string;
    shared_record_key_cipher: string;
    shared_nonce: string;
  } | null;
};


export type PublicUser = { user_id: string; username: string; public_key: string };

export type ShareRecipient = {
  share_id: string;
  to_user_id: string;
  to_username: string;
  revoked: boolean;
  created_at: string;
  revoked_at?: string | null;
};


export type BootstrapStatus = { needs_bootstrap: boolean };
export type CryptoConfig = {
  argon2_time_cost: number;
  argon2_memory_kib: number;
  argon2_parallelism: number;
  argon2_hash_len: number;
  credential_rotation_days: number;
};

export type IntegrationStatus = {
  provider: string;
  sso_enabled: boolean;
  account_sync_enabled: boolean;
  note: string;
};

export type BootstrapClaimBody = {
  token: string;
  username: string;
  email: string;
  password_salt: string;
  password_verifier: string;
  rek_ciphertext: string;
  rek_nonce: string;
  public_key: string;
};

export async function getBootstrapStatusApi(): Promise<BootstrapStatus> {
  const r = await fetchWithLocalFallback("/admin/bootstrap/status");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function bootstrapClaimApi(body: BootstrapClaimBody): Promise<{ success: boolean; user_id: string }> {
  const r = await fetchWithLocalFallback("/admin/bootstrap/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}


export async function registerUser(body: RegisterBody): Promise<{ success: boolean; user_id: string }> {
  // Registration sends verifier + wrapped key material only; plaintext master password is never sent.
  const r = await fetchWithLocalFallback("/users/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function loginMaterialApi(username: string): Promise<LoginMaterialResponse> {
  // Login step 1 requests only encrypted materials; no token is issued yet.
  const r = await fetchWithLocalFallback("/users/login/material", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function loginProofApi(username: string, verifier_proof: string): Promise<LoginResponse> {
  // Login step 2 submits verifier proof; backend issues token only if proof matches stored verifier.
  const r = await fetchWithLocalFallback("/users/login/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, verifier_proof }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCryptoConfigApi(): Promise<CryptoConfig> {
  const r = await fetchWithLocalFallback("/users/crypto-config");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createCredentialApi(
  token: string,
  body: {
    title: string;
    system_name: string;
    password_ciphertext: string;
    data_nonce: string;
    record_key_ciphertext: string;
    record_key_nonce: string;
  }
): Promise<{ success: boolean; credential_id: string }> {
  // Credential payload is already encrypted before this request.
  const r = await fetch(`${getApiBase()}/credentials/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listCredentialsApi(token: string): Promise<CredentialListItem[]> {
  const r = await fetch(`${getApiBase()}/credentials/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCredentialApi(token: string, id: string): Promise<CredentialOut> {
  const r = await fetch(`${getApiBase()}/credentials/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateCredentialApi(
  token: string,
  id: string,
  body: { title?: string; system_name?: string; password_ciphertext?: string; data_nonce?: string }
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/credentials/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function rotateCredentialKeyApi(
  token: string,
  id: string,
  body: { password_ciphertext: string; data_nonce: string; record_key_ciphertext: string; record_key_nonce: string }
): Promise<{ success: boolean; last_rotated_at: string }> {
  const r = await fetch(`${getApiBase()}/credentials/${id}/rotate-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteCredentialApi(token: string, id: string): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/credentials/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listPublicUsersApi(token: string, page?: PaginationOptions): Promise<PublicUser[]> {
  const r = await fetch(withPagination(`${getApiBase()}/users/public`, page), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createShareApi(
  token: string,
  body: { credential_id: string; to_user_id: string; shared_record_key_cipher: string; shared_nonce: string }
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/shares`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function listSharesForCredentialApi(
  token: string,
  credentialId: string,
  page?: PaginationOptions
): Promise<ShareRecipient[]> {
  const r = await fetch(withPagination(`${getApiBase()}/shares/credential/${credentialId}`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function revokeShareApi(token: string, shareId: string): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/shares/${shareId}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateMyEmailApi(token: string, email: string): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/users/me/email`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateMyUsernameApi(token: string, username: string): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/users/me/username`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateMyPasswordApi(
  token: string,
  body: {
    password_salt: string;
    password_verifier: string;
    rek_ciphertext: string;
    rek_nonce: string;
  }
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/users/me/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function reportDecryptFailureApi(
  token: string,
  body: { stage: string; credential_id?: string; reason?: string }
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/users/me/decrypt-failure`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteMyAccountApi(token: string): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/users/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminListUsersApi(token: string, page?: PaginationOptions): Promise<AdminUser[]> {
  const r = await fetch(withPagination(`${getApiBase()}/admin/users`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminDbCredentialsApi(token: string, page?: PaginationOptions): Promise<DbCredentialRow[]> {
  const r = await fetch(withPagination(`${getApiBase()}/admin/db/credentials`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminDbUsersApi(token: string, page?: PaginationOptions): Promise<DbUserRow[]> {
  const r = await fetch(withPagination(`${getApiBase()}/admin/db/users`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminDbSharesApi(token: string, page?: PaginationOptions): Promise<DbShareRow[]> {
  const r = await fetch(withPagination(`${getApiBase()}/admin/db/shares`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminAuditApi(token: string, page?: PaginationOptions): Promise<AuditRow[]> {
  const r = await fetch(withPagination(`${getApiBase()}/admin/audit`, page), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminSetPermissionsApi(
  token: string,
  userId: string,
  body: {
    can_change_username?: boolean;
    can_change_email?: boolean;
    can_change_password?: boolean;
    can_share?: boolean;
  }
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/admin/users/${userId}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminSetAdminApi(token: string, userId: string, is_admin: boolean): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/admin/users/${userId}/admin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ is_admin }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminSetRoleApi(
  token: string,
  userId: string,
  role: "admin" | "editor" | "viewer"
): Promise<{ success: boolean }> {
  const r = await fetch(`${getApiBase()}/admin/users/${userId}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminGetCryptoConfigApi(token: string): Promise<CryptoConfig> {
  const r = await fetch(`${getApiBase()}/admin/crypto-config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminSetCryptoConfigApi(
  token: string,
  body: Partial<CryptoConfig>
): Promise<CryptoConfig> {
  const r = await fetch(`${getApiBase()}/admin/crypto-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function adminIntegrationStatusApi(token: string): Promise<IntegrationStatus> {
  const r = await fetch(`${getApiBase()}/admin/integrations/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
