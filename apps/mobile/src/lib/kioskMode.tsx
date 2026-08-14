import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const KIOSK_KEY = "bg-gold.attendance.showroom-kiosk.v1";

export type StoredKiosk = {
  id: string;
  token: string;
  deviceLabel: string;
  showroom: { id: string; code: string; name: string; address?: string };
};

type KioskModeValue = {
  ready: boolean;
  kiosk: StoredKiosk | null;
  activate: (kiosk: StoredKiosk) => Promise<void>;
  clear: () => Promise<void>;
};

const KioskModeContext = createContext<KioskModeValue | null>(null);

export function KioskModeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [kiosk, setKiosk] = useState<StoredKiosk | null>(null);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(KIOSK_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        try {
          const parsed = JSON.parse(raw) as StoredKiosk;
          if (parsed.id && parsed.token && parsed.showroom?.id) setKiosk(parsed);
        } catch {
          void SecureStore.deleteItemAsync(KIOSK_KEY);
        }
      })
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<KioskModeValue>(() => ({
    ready,
    kiosk,
    activate: async (next) => {
      await SecureStore.setItemAsync(KIOSK_KEY, JSON.stringify(next));
      setKiosk(next);
    },
    clear: async () => {
      await SecureStore.deleteItemAsync(KIOSK_KEY);
      setKiosk(null);
    },
  }), [kiosk, ready]);

  return <KioskModeContext.Provider value={value}>{children}</KioskModeContext.Provider>;
}

export function useKioskMode() {
  const value = useContext(KioskModeContext);
  if (!value) throw new Error("useKioskMode must be used inside KioskModeProvider");
  return value;
}
