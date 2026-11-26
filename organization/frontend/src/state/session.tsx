import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, setSessionLostHandler, type Policy, type SessionInfo } from "../lib/api";
import { cryptoAvailable, derivePasswordKeys, unlockAccount, type PasswordKeys, type VaultKeys } from "../lib/crypto";
import { useI18n } from "../i18n";

export type Phase = "loading" | "insecure" | "unreachable" | "setup" | "signedOut" | "locked" | "ready";

interface SessionState {
  phase: Phase;
  policy: Policy | null;
  session: SessionInfo | null;
  keys: VaultKeys | null;

  expired: boolean;

  challenge: { emailHint: string } | null;
  mailEnabled: boolean;
  start: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  resendCode: () => Promise<void>;
  cancelChallenge: () => void;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

const HEARTBEAT_MS = 4 * 60 * 1000;
const IDLE_CHECK_MS = 10 * 1000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const { adoptLang } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [keys, setKeys] = useState<VaultKeys | null>(null);
  const [expired, setExpired] = useState(false);
  const [challenge, setChallenge] = useState<{ emailHint: string } | null>(null);
  const [mailEnabled, setMailEnabled] = useState(false);

  const pending = useRef<{ ticket: string; keys: PasswordKeys } | null>(null);
  const lastActivity = useRef(Date.now());

  const accept = useCallback(
    (info: SessionInfo) => {
      setSession(info);
      setPolicy(info.policy);
      setMailEnabled(info.mail_enabled);
      adoptLang(info.user.preferred_language);
    },
    [adoptLang],
  );

  const phaseRef = useRef<Phase>("loading");
  const enter = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const hasSession = () => phaseRef.current === "ready" || phaseRef.current === "locked";

  const drop = useCallback(
    (wasExpired: boolean) => {
      if (!hasSession()) return;
      setKeys(null);
      setSession(null);
      setExpired(wasExpired);
      enter("signedOut");
    },
    [enter],
  );

  const start = useCallback(async () => {
    if (!cryptoAvailable()) {
      enter("insecure");
      return;
    }
    try {
      const status = await api.status();
      setPolicy(status.policy);
      setMailEnabled(status.mail_enabled);
      if (status.setup_required) {
        enter("setup");
        return;
      }
      try {
        accept(await api.session());
        enter("locked");
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        enter("signedOut");
      }
    } catch {
      enter("unreachable");
    }
  }, [accept, enter]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    setSessionLostHandler(() => drop(true));
    return () => setSessionLostHandler(null);
  }, [drop]);

  const enterVault = useCallback(
    async (info: SessionInfo, passwordKeys: PasswordKeys) => {
      const vaultKeys = await unlockAccount(passwordKeys.wrapKey, info);
      accept(info);
      setKeys(vaultKeys);
      setExpired(false);
      setChallenge(null);
      pending.current = null;
      lastActivity.current = Date.now();
      enter("ready");
    },
    [accept, enter],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const kdf = await api.prelogin(username);
      const passwordKeys = await derivePasswordKeys(password, kdf);
      const result = await api.login(username, passwordKeys.authKey);
      if ("two_factor_required" in result) {
        pending.current = { ticket: result.ticket, keys: passwordKeys };
        setChallenge({ emailHint: result.email_hint });
        return;
      }
      await enterVault(result, passwordKeys);
    },
    [enterVault],
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pending.current) throw new Error("No sign-in in progress");
      await enterVault(await api.loginVerify(pending.current.ticket, code), pending.current.keys);
    },
    [enterVault],
  );

  const resendCode = useCallback(async () => {
    if (!pending.current) throw new Error("No sign-in in progress");
    const next = await api.loginResend(pending.current.ticket);
    pending.current = { ...pending.current, ticket: next.ticket };
    setChallenge({ emailHint: next.email_hint });
  }, []);

  const cancelChallenge = useCallback(() => {
    pending.current = null;
    setChallenge(null);
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!session) throw new Error("No session");
      const passwordKeys = await derivePasswordKeys(password, session.kdf);
      const vaultKeys = await unlockAccount(passwordKeys.wrapKey, session);

      accept(await api.session().catch((error) => {
        if (error instanceof ApiError && error.status === 401) drop(true);
        throw error;
      }));
      setKeys(vaultKeys);
      lastActivity.current = Date.now();
      enter("ready");
    },
    [session, accept, drop, enter],
  );

  const lock = useCallback(() => {
    if (phaseRef.current !== "ready") return;
    setKeys(null);
    enter("locked");
  }, [enter]);

  const signOut = useCallback(async () => {
    drop(false);
    await api.logout().catch(() => undefined);
  }, [drop]);

  const refresh = useCallback(async () => {
    accept(await api.session());
  }, [accept]);

  const timeoutMinutes = policy?.vault_timeout_minutes ?? 10;
  useEffect(() => {
    if (phase !== "ready") return;
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));

    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutMinutes * 60_000) lock();
    }, IDLE_CHECK_MS);
    const heartbeat = window.setInterval(() => {
      if (Date.now() - lastActivity.current < HEARTBEAT_MS) {
        api.session().catch((error) => {
          if (error instanceof ApiError && error.status === 401) drop(true);
        });
      }
    }, HEARTBEAT_MS);

    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      window.clearInterval(idleTimer);
      window.clearInterval(heartbeat);
    };
  }, [phase, timeoutMinutes, lock, drop]);

  const value = useMemo<SessionState>(
    () => ({
      phase, policy, session, keys, expired, challenge, mailEnabled,
      start, signIn, verifyCode, resendCode, cancelChallenge, unlock, lock, signOut, refresh,
    }),
    [
      phase, policy, session, keys, expired, challenge, mailEnabled,
      start, signIn, verifyCode, resendCode, cancelChallenge, unlock, lock, signOut, refresh,
    ],
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
