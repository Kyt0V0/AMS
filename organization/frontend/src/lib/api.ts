import type { KdfParams, NewAccount, WrappedAccount } from "./crypto";

export type Role = "admin" | "editor" | "viewer";

export interface Policy {
  kdf_time_cost: number;
  kdf_memory_kib: number;
  kdf_parallelism: number;
  min_password_length: number;
  password_max_age_days: number;
  vault_timeout_minutes: number;
  open_registration: boolean;
  require_two_factor: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  can_share: boolean;
  can_edit_profile: boolean;
  preferred_language: string | null;
  two_factor_enabled: boolean;
  created_at: string;
  password_changed_at: string;
}

export interface SessionInfo extends WrappedAccount {
  user: User;
  policy: Policy;
  mail_enabled: boolean;
  session: { id: string; expires_at: string; idle_minutes: number };
}

export interface LoginChallenge {
  two_factor_required: true;
  ticket: string;
  email_hint: string;
}

export interface ApiCredential {
  id: string;
  owner_id: string;
  owner_username: string;
  is_owner: boolean;
  ciphertext: string;
  wrapped_key: string;
  owner_public_key: string | null;
  shared_with: number;
  version: number;
  created_at: string;
  updated_at: string;
  key_rotated_at: string;
}

export interface DirectoryUser {
  id: string;
  username: string;
  public_key: string;
}

export interface ShareRecipient {
  recipient_id: string;
  username: string;
  public_key: string;
  created_at: string;
}

export interface DeviceSession {
  id: string;
  current: boolean;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: Role;
  is_active: boolean;
  can_share: boolean;
  can_edit_profile: boolean;
  two_factor_enabled: boolean;
  entries: number;
  created_at: string;
  last_login_at: string | null;
}

export interface Invite {
  id: string;
  label: string;
  role: Role;
  created_at: string;
  expires_at: string;
  status: "pending" | "used" | "expired";
}

export interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface Overview {
  users: number;
  active_users: number;
  admins: number;
  entries: number;
  shares: number;
  sessions: number;
  pending_invites: number;
  failed_logins_24h: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

async function request<T>(method: string, path: string, body?: unknown, quiet401 = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-AMS-Request": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", 0);
  }

  const payload = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  if (response.status === 401 && !quiet401) onSessionLost?.();
  const detail = payload && typeof payload.detail === "string" ? payload.detail : `Request failed (${response.status})`;
  const retry = Number(response.headers.get("Retry-After"));
  throw new ApiError(detail, response.status, Number.isFinite(retry) && retry > 0 ? retry : null);
}

const get = <T>(path: string, quiet401 = false) => request<T>("GET", path, undefined, quiet401);
const post = <T>(path: string, body?: unknown, quiet401 = false) => request<T>("POST", path, body ?? {}, quiet401);

type Registration = NewAccount & { username: string; email: string };

export const api = {
  status: () => get<{ setup_required: boolean; policy: Policy; mail_enabled: boolean }>("/auth/status"),

  localSetupToken: () => get<{ token: string }>("/auth/setup-token", true),
  setup: (body: Registration & { setup_token: string }) => post<{ ok: true }>("/auth/setup", body),
  checkInvite: (token: string) => post<{ role: Role; expires_at: string }>("/auth/invite/check", { token }),
  register: (body: Registration & { invite_token?: string }) => post<{ ok: true }>("/auth/register", body),
  prelogin: (username: string) => post<KdfParams>("/auth/prelogin", { username }),
  login: (username: string, auth_key: string) =>
    post<SessionInfo | LoginChallenge>("/auth/login", { username, auth_key }, true),
  loginVerify: (ticket: string, code: string) => post<SessionInfo>("/auth/login/verify", { ticket, code }, true),
  loginResend: (ticket: string) => post<LoginChallenge>("/auth/login/resend", { ticket }, true),
  session: () => get<SessionInfo>("/auth/session", true),
  logout: () => post<{ ok: true }>("/auth/logout", undefined, true),
  recoverStart: (username: string, recovery_auth_key: string) =>
    post<{ recovery_wrapped_vault_key: string; policy: Policy }>(
      "/auth/recover/start",
      { username, recovery_auth_key },
      true,
    ),
  recoverFinish: (body: object) => post<{ ok: true }>("/auth/recover/finish", body, true),

  updateProfile: (body: { username?: string; email?: string; preferred_language?: string; current_auth_key?: string }) =>
    request<{ username: string; email: string; preferred_language: string | null }>("PATCH", "/account/profile", body),
  startEmailChange: (email: string, currentAuthKey: string) =>
    post<{ email_hint: string }>("/account/email/start", { email, current_auth_key: currentAuthKey }),
  confirmEmailChange: (code: string) => post<{ email: string }>("/account/email/confirm", { code }),
  startTwoFactor: () => post<{ email_hint: string }>("/account/two-factor/start"),
  enableTwoFactor: (code: string) => post<{ two_factor_enabled: true }>("/account/two-factor/enable", { code }),
  disableTwoFactor: (current_auth_key: string) =>
    post<{ two_factor_enabled: false }>("/account/two-factor/disable", { current_auth_key }),
  changePassword: (body: object) => request<{ ok: true }>("PUT", "/account/password", body),
  replaceRecovery: (body: object) => request<{ ok: true }>("PUT", "/account/recovery", body),
  sessions: () => get<DeviceSession[]>("/account/sessions"),
  revokeSession: (id: string) => request<{ ok: true }>("DELETE", `/account/sessions/${id}`),
  revokeOtherSessions: () => post<{ revoked: number }>("/account/sessions/revoke-others"),
  deleteAccount: (current_auth_key: string) => post<{ ok: true }>("/account/delete", { current_auth_key }),

  directory: () => get<DirectoryUser[]>("/users"),
  credentials: () => get<ApiCredential[]>("/credentials"),
  createCredential: (body: { id: string; ciphertext: string; wrapped_key: string }) =>
    post<{ id: string; version: number }>("/credentials", body),
  updateCredential: (id: string, body: { ciphertext: string; version: number }) =>
    request<{ version: number }>("PUT", `/credentials/${id}`, body),
  deleteCredential: (id: string) => request<{ ok: true }>("DELETE", `/credentials/${id}`),
  shares: (id: string) => get<ShareRecipient[]>(`/credentials/${id}/shares`),
  share: (id: string, body: { recipient_id: string; wrapped_key: string }) =>
    post<{ ok: true }>(`/credentials/${id}/shares`, body),
  rotate: (
    id: string,
    body: {
      ciphertext: string;
      wrapped_key: string;
      version: number;
      shares: { recipient_id: string; wrapped_key: string }[];
    },
  ) => post<{ version: number; key_rotated_at: string }>(`/credentials/${id}/rotate`, body),
  leaveShare: (id: string) => request<{ ok: true }>("DELETE", `/credentials/${id}/shares/me`),

  adminOverview: () => get<Overview>("/admin/overview"),
  adminUsers: () => get<AdminUser[]>("/admin/users"),
  adminUpdateUser: (
    id: string,
    body: Partial<Pick<AdminUser, "role" | "is_active" | "can_share" | "can_edit_profile">> & { two_factor_enabled?: false },
  ) => request<{ ok: true }>("PATCH", `/admin/users/${id}`, body),
  adminRevokeSessions: (id: string) => post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`),
  adminDeleteUser: (id: string) => request<{ ok: true }>("DELETE", `/admin/users/${id}`),
  adminInvites: () => get<Invite[]>("/admin/invites"),
  adminCreateInvite: (body: { label: string; role: Role; expires_in_days: number }) =>
    post<{ id: string; token: string; role: Role; expires_at: string }>("/admin/invites", body),
  adminRevokeInvite: (id: string) => request<{ ok: true }>("DELETE", `/admin/invites/${id}`),
  adminPolicy: () => get<Policy>("/admin/policy"),
  adminUpdatePolicy: (body: Partial<Policy>) => request<Policy>("PUT", "/admin/policy", body),
  adminAudit: (params: { limit: number; offset: number; action?: string }) => {
    const query = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.action) query.set("action", params.action);
    return get<{ total: number; items: AuditRow[] }>(`/admin/audit?${query}`);
  },
};
