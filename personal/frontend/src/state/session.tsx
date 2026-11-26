import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, setSessionLostHandler, type Policy, type SessionInfo, type Status } from "../lib/api";
import { cryptoAvailable, derivePasswordKeys, unlockAccount, type VaultKeys } from "../lib/crypto";

export type Phase = "loading" | "insecure" | "unreachable" | "setup" | "locked" | "ready";

interface SessionState {
  phase: Phase;
  policy: Policy | null;

  ownerName: string;
  session: SessionInfo | null;
  keys: VaultKeys | null;

  expired: boolean;
  start: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

const HEARTBEAT_MS = 4 * 60 * 1000;
const IDLE_CHECK_MS = 10 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [keys, setKeys] = useState<VaultKeys | null>(null);
  const [expired, setExpired] = useState(false);
  const lastActivity = useRef(Date.now());

  const phaseRef = useRef<Phase>("loading");
  const enter = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const close = useCallback(
    (wasExpired: boolean) => {
      if (phaseRef.current !== "ready") return;
      setKeys(null);
      setSession(null);
      setExpired(wasExpired);
      enter("locked");
    },
    [enter],
  );

  const start = useCallback(async () => {
    if (!cryptoAvailable()) {
      enter("insecure");
      return;
    }
    try {
      const next = await api.status();
      setStatus(next);
      setKeys(null);
      setSession(null);
      enter(next.setup_required ? "setup" : "locked");
    } catch {
      enter("unreachable");
    }
  }, [enter]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    setSessionLostHandler(() => close(true));
    return () => setSessionLostHandler(null);
  }, [close]);

  const unlock = useCallback(
    async (password: string) => {
      const current = await api.status();
      setStatus(current);
      if (!current.kdf) throw new Error("No vault");
      const passwordKeys = await derivePasswordKeys(password, current.kdf);
      const info = await api.login(passwordKeys.authKey);
      const vaultKeys = await unlockAccount(passwordKeys.wrapKey, info);
      setSession(info);
      setKeys(vaultKeys);
      setExpired(false);
      lastActivity.current = Date.now();
      enter("ready");
    },
    [enter],
  );

  const lock = useCallback(async () => {
    close(false);
    await api.logout().catch(() => undefined);
  }, [close]);

  const refresh = useCallback(async () => {
    setSession(await api.session());
    setStatus(await api.status());
  }, []);

  const policy = session?.policy ?? status?.policy ?? null;
  const timeoutMinutes = policy?.vault_timeout_minutes ?? 10;
  useEffect(() => {
    if (phase !== "ready") return;
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));

    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutMinutes * 60_000) {
        close(true);
        api.logout().catch(() => undefined);
      }
    }, IDLE_CHECK_MS);
    const heartbeat = window.setInterval(() => {
      if (Date.now() - lastActivity.current < HEARTBEAT_MS) {
        api.session().catch((error) => {
          if (error instanceof ApiError && error.status === 401) close(true);
        });
      }
    }, HEARTBEAT_MS);

    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(idleTimer);
      window.clearInterval(heartbeat);
    };
  }, [phase, timeoutMinutes, close]);

  const ownerName = session?.user.name ?? status?.name ?? "";
  const value = useMemo<SessionState>(
    () => ({ phase, policy, ownerName, session, keys, expired, start, unlock, lock, refresh }),
    [phase, policy, ownerName, session, keys, expired, start, unlock, lock, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is missing");
  return context;
}

export function useUnlocked() {
  const { session, keys, policy, ...rest } = useSession();
  if (!session || !keys || !policy) throw new Error("Vault is locked");
  return { session, keys, policy, user: session.user, ...rest };
}
