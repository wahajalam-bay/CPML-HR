"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/overlays";
import { StoreProvider } from "@/lib/providers/store-provider";
import { FilterProvider } from "@/lib/providers/filter-provider";
import {
  SessionProvider,
  type ServerSession,
} from "@/lib/providers/session-provider";

export function AppProviders({
  children,
  nonce,
  serverSession,
}: {
  children: React.ReactNode;
  /** Per-request CSP nonce, so next-themes' pre-paint script may execute. */
  nonce?: string;
  /**
   * The identity resolved from the session cookie, or null in the demo posture.
   * Passed down to be the session provider's initial state, so the first render
   * already has the right role rather than correcting itself afterwards.
   */
  serverSession?: ServerSession | null;
}) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange={false}
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        <SessionProvider serverSession={serverSession}>
          <StoreProvider>
            <FilterProvider>
              <TooltipProvider delayDuration={220} skipDelayDuration={300}>
                {children}
                <Toaster
                  position="bottom-right"
                  duration={2400}
                  toastOptions={{
                    className:
                      "!rounded-[var(--r-pill)] !border !border-line !bg-overlay !text-ink !text-meta !shadow-[var(--sh-3)]",
                  }}
                />
              </TooltipProvider>
            </FilterProvider>
          </StoreProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
