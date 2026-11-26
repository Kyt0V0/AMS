import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { analyseHealth, loadEntries, type Entry, type EntryHealth } from "../lib/vault";
import { errorText } from "../components/ui";
import { useI18n } from "../i18n";
import { useUnlocked } from "./session";

interface VaultState {
  entries: Entry[];
  health: Map<string, EntryHealth>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const VaultContext = createContext<VaultState | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { keys, user, policy } = useUnlocked();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      setEntries(await loadEntries(keys, user.id));
      setFailure(null);
    } catch (caught) {
      setFailure(caught ?? new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [keys, user.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const health = useMemo(() => analyseHealth(entries, policy.password_max_age_days), [entries, policy.password_max_age_days]);
  const error = failure === null ? null : errorText(t, failure);
  const value = useMemo(() => ({ entries, health, loading, error, reload }), [entries, health, loading, error, reload]);
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultState {
  const context = useContext(VaultContext);
  if (!context) throw new Error("VaultProvider is missing");
  return context;
}
