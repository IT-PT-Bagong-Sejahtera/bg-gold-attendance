import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  api,
  setAccessTokenRenewalHandler,
  type TokenPair,
} from "./api";
import {
  createDemoSession,
  demoRoleFromToken,
  isDemoAccessToken,
  type DemoRole,
} from "./demoSession";

const SESSION_KEY = "bg-gold.attendance.session";
type AuthContextValue = {
  session: TokenPair | null;
  ready: boolean;
  isDemo: boolean;
  demoRole: DemoRole | null;
  login(email: string, password: string): Promise<void>;
  enterDemo(role?: DemoRole): Promise<void>;
  switchOrganization(organizationId: string): Promise<void>;
  logout(): Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<TokenPair | null>(null);
  const sessionRef = useRef<TokenPair | null>(null);
  const [ready, setReady] = useState(false);
  const save = useCallback(async (value: TokenPair | null) => {
    sessionRef.current = value;
    setSession(value);
    if (value)
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value));
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  }, []);

  useEffect(() => {
    setAccessTokenRenewalHandler(async (failedAccessToken) => {
      const current = sessionRef.current;
      if (!current) return null;
      if (current.accessToken !== failedAccessToken) {
        return current.accessToken;
      }
      try {
        const next = await api.refresh(current.refreshToken);
        await save(next);
        return next.accessToken;
      } catch {
        await save(null);
        return null;
      }
    });
    return () => setAccessTokenRenewalHandler(null);
  }, [save]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as TokenPair;
        if (demoRoleFromToken(stored.accessToken) === "device") {
          // Demo kiosk lama mengikat HP ke satu karyawan. Migrasikan sesi lama
          // ke supervisor agar kiosk baru selalu diaktifkan dari Profil dan
          // diikat ke Master Showroom.
          if (active) await save(createDemoSession("supervisor"));
          return;
        }
        if (new Date(stored.accessExpiresAt).getTime() > Date.now() + 30_000) {
          if (active) setSession(stored);
        } else {
          const next = await api.refresh(stored.refreshToken);
          if (active) await save(next);
        }
      } catch {
        if (active) await save(null);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [save]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      ready,
      isDemo: isDemoAccessToken(session?.accessToken),
      demoRole: demoRoleFromToken(session?.accessToken),
      async login(email, password) {
        await save(await api.login(email, password));
      },
      async enterDemo(role = "employee") {
        await save(createDemoSession(role));
      },
      async switchOrganization(organizationId) {
        if (!session) return;
        await save(
          await api.switchOrganization(session.accessToken, organizationId),
        );
      },
      async logout() {
        try {
          if (session) await api.logout(session.accessToken);
        } finally {
          await save(null);
        }
      },
    }),
    [ready, save, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
