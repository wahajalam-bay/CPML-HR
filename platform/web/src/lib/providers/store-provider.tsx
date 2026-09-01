"use client";

import * as React from "react";
import { loadStore } from "@/lib/data/store";
import { DATASET_MODE } from "@/lib/auth/permissions";
import { useSession } from "@/lib/providers/session-provider";
import type { RecruitmentStore } from "@/lib/data/schema";

interface StoreContextValue {
  store: RecruitmentStore | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

const StoreContext = React.createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = React.useState<RecruitmentStore | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [nonce, setNonce] = React.useState(0);

  /**
   * The provider sits in the root layout, which covers the sign-in and
   * password-reset pages too. Fetching there is worse than wasteful: in
   * `server-scoped` mode the endpoint requires a session, so an anonymous
   * visitor to /signin got a 401 in the console on every page load — a real
   * error that would mask a real one.
   */
  const { session } = useSession();
  const shouldLoad = DATASET_MODE === "client-full" || session.authenticated;

  React.useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;
    setError(null);
    loadStore()
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, shouldLoad]);

  const value = React.useMemo<StoreContextValue>(
    () => ({
      store,
      error,
      // Not loading when there is nothing to load — otherwise the auth pages
      // would sit under a permanent skeleton.
      loading: shouldLoad && !store && !error,
      reload: () => setNonce((n) => n + 1),
    }),
    [store, error, shouldLoad],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreState(): StoreContextValue {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStoreState must be used inside <StoreProvider>");
  return ctx;
}

/**
 * The store, guaranteed non-null.
 *
 * Every analytics surface renders under `<DataGate>`, which holds the skeleton
 * until the dataset is hydrated — so page code can treat the store as present
 * rather than threading null checks through every chart.
 */
export function useStore(): RecruitmentStore {
  const { store } = useStoreState();
  if (!store) {
    throw new Error("useStore called before the dataset finished loading");
  }
  return store;
}
