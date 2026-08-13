import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { login as loginRequest, logout as logoutRequest, refresh as refreshRequest, type TokenPair } from "./api";

const STORAGE_KEY = "bg-gold.session";

type AuthValue = {
  session: TokenPair | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function readStored(): TokenPair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<TokenPair | null>(readStored);
  const [ready, setReady] = useState(false);

  const persist = useCallback((next: TokenPair | null) => {
    setSession(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    let active = true;
    async function restore() {
      const stored = readStored();
      if (!stored) {
        if (active) setReady(true);
        return;
      }
      if (new Date(stored.accessExpiresAt).getTime() > Date.now() + 30_000) {
        if (active) setReady(true);
        return;
      }
      try {
        const next = await refreshRequest(stored.refreshToken);
        if (active) persist(next);
      } catch {
        if (active) persist(null);
      } finally {
        if (active) setReady(true);
      }
    }
    void restore();
    return () => { active = false; };
  }, [persist]);

  const value = useMemo<AuthValue>(() => ({
    session,
    ready,
    async login(email, password) { persist(await loginRequest(email, password)); },
    async logout() { try { if (session) await logoutRequest(session.accessToken); } finally { persist(null); } },
  }), [persist, ready, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
