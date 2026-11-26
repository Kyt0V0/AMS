import React, { createContext, useContext, useMemo, useState } from "react";

type AuthState = {
  token: string | null;
  userId: string | null;
  username: string | null;
  email: string | null;
  isAdmin: boolean;
  permissions: {
    can_change_username: boolean;
    can_change_email: boolean;
    can_change_password: boolean;
    can_share: boolean;
  };
  rek: Uint8Array | null;
  x25519Private: Uint8Array | null;
  x25519Public: Uint8Array | null;
};

type AuthContextType = AuthState & {
  setAuth: (next: AuthState) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // AQA NEA note: auth context keeps only in-memory session state; sensitive keys are not written to the backend.
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    username: null,
    email: null,
    isAdmin: false,
    permissions: {
      can_change_username: true,
      can_change_email: true,
      can_change_password: true,
      can_share: true,
    },
    rek: null,
    x25519Private: null,
    x25519Public: null,
  });

  const value = useMemo<AuthContextType>(
    () => ({
      ...state,
      setAuth: (next) => setState(next),
      logout: () =>
        // AQA NEA note: logout clears token + decrypted key material from active UI state.
        setState({
          token: null,
          userId: null,
          username: null,
          email: null,
          isAdmin: false,
          permissions: {
            can_change_username: true,
            can_change_email: true,
            can_change_password: true,
            can_share: true,
          },
          rek: null,
          x25519Private: null,
          x25519Public: null,
        }),
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthContext not found");
  return ctx;
}
