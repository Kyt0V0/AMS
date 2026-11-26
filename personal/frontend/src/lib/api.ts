import type { KdfParams, NewAccount, WrappedAccount } from "./crypto";

export interface Policy {
  kdf_time_cost: number;
  kdf_memory_kib: number;
  kdf_parallelism: number;
  min_password_length: number;
  password_max_age_days: number;
  vault_timeout_minutes: number;
}

export interface User {
  id: string;
  name: string;
  created_at: string;
  password_changed_at: string;
}

export interface SessionInfo extends WrappedAccount {
  user: User;
  policy: Policy;
  session: { id: string; expires_at: string; idle_minutes: number };
}

export interface Status {
  setup_required: boolean;
  policy: Policy;
  kdf: KdfParams | null;
  name: string | null;
}

export interface ApiCredential {
  id: string;
  ciphertext: string;
  wrapped_key: string;
  version: number;
  created_at: string;
  updated_at: string;
  key_rotated_at: string;
}

export interface ActivityRow {
  id: number;
  at: string;
  action: string;
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

export const api = {
  status: () => get<Status>("/auth/status"),
  setup: (body: NewAccount & { name: string }) => post<{ ok: true }>("/auth/setup", body),
  login: (auth_key: string) => post<SessionInfo>("/auth/login", { auth_key }, true),
  session: () => get<SessionInfo>("/auth/session", true),
  logout: () => post<{ ok: true }>("/auth/logout", undefined, true),
  recoverStart: (recovery_auth_key: string) =>
    post<{ recovery_wrapped_vault_key: string; policy: Policy }>("/auth/recover/start", { recovery_auth_key }, true),
  recoverFinish: (body: object) => post<{ ok: true }>("/auth/recover/finish", body, true),

  updateProfile: (name: string) => request<{ name: string }>("PATCH", "/account/profile", { name }),
  changePassword: (body: object) => request<{ ok: true }>("PUT", "/account/password", body),
  replaceRecovery: (body: object) => request<{ ok: true }>("PUT", "/account/recovery", body),
  updatePreferences: (body: Partial<Policy>) => request<Policy>("PUT", "/account/preferences", body),
  activity: () => get<ActivityRow[]>("/account/activity"),
  deleteVault: (current_auth_key: string) => post<{ ok: true }>("/account/delete", { current_auth_key }),

  credentials: () => get<ApiCredential[]>("/credentials"),
  createCredential: (body: { id: string; ciphertext: string; wrapped_key: string }) =>
    post<{ id: string; version: number }>("/credentials", body),
  updateCredential: (id: string, body: { ciphertext: string; version: number }) =>
    request<{ version: number }>("PUT", `/credentials/${id}`, body),
  rotate: (id: string, body: { ciphertext: string; wrapped_key: string; version: number }) =>
    post<{ version: number; key_rotated_at: string }>(`/credentials/${id}/rotate`, body),
  deleteCredential: (id: string) => request<{ ok: true }>("DELETE", `/credentials/${id}`),
};
