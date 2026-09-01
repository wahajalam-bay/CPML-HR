"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, DatabaseZap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useStore, useStoreState } from "@/lib/providers/store-provider";
import { Sidebar, MobileNav } from "./sidebar";
import { AppHeader } from "./app-header";
import { CommandPalette, usePaletteShortcuts } from "./command-palette";
import { FilterBar } from "@/components/filters/filter-bar";
import { RouteGuard, ScopeBanner } from "@/components/auth/guards";
import { useAlerts } from "@/lib/hooks/use-alerts";

/**
 * Routes with no global filter bar.
 *
 * Reports renders its own controls. The administration pages are not analytics
 * at all — a date range and a recruiter filter over a list of user accounts
 * filter nothing, and a "28,366 records" counter above three accounts is simply
 * wrong.
 */
const NO_FILTER_BAR = ["/reports", "/admin"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  usePaletteShortcuts(openPalette);

  const showFilters = !NO_FILTER_BAR.some((p) => pathname.startsWith(p));

  return (
    <div className="flex min-h-dvh">
      <div className="decor" aria-hidden />
      <Sidebar onOpenPalette={openPalette} />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="relative z-[1] min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1560px] px-3 pb-16 sm:px-5">
          <HeaderWithAlerts
            onOpenPalette={openPalette}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />
          {/* The guard sits OUTSIDE the data gate, deliberately. A refusal does
              not depend on the dataset, and nesting it inside meant two things
              went wrong: the user waited for a 552 KB download before being
              told they could not open the page, and the refusal could not
              render on the server at all — the gate resolves to a skeleton
              there, so the authenticated layout's own check produced a
              skeleton instead of an explanation. Only the filter bar, the scope
              banner and the page itself actually need the data. */}
          <RouteGuard>
            <DataGate>
              {showFilters ? <FilterBar /> : null}
              <ScopeBanner />
              {children}
            </DataGate>
          </RouteGuard>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/**
 * The header needs the alert count, which needs the dataset — but the header
 * must render before the dataset arrives. This splits the dependency so the
 * chrome paints immediately and the badge fills in.
 */
function HeaderWithAlerts({
  onOpenPalette,
  onOpenMobileNav,
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
}) {
  const { store } = useStoreState();
  return store ? (
    <HeaderInner onOpenPalette={onOpenPalette} onOpenMobileNav={onOpenMobileNav} />
  ) : (
    <AppHeader onOpenPalette={onOpenPalette} onOpenMobileNav={onOpenMobileNav} />
  );
}

function HeaderInner({
  onOpenPalette,
  onOpenMobileNav,
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
}) {
  const alerts = useAlerts();
  const store = useStore();
  return (
    <AppHeader
      onOpenPalette={onOpenPalette}
      onOpenMobileNav={onOpenMobileNav}
      recruiters={store.dicts.recruiter ?? []}
      alertCount={alerts.filter((a) => a.severity !== "info").length}
      onOpenAlerts={() => {
        document.getElementById("alerts-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    />
  );
}

/* =========================================================================
 * Data gate — skeletons on first load, a real error state on failure
 * ========================================================================= */

export function DataGate({ children }: { children: React.ReactNode }) {
  const { store, error, loading, reload } = useStoreState();

  if (error) {
    return (
      <div className="panel">
        <EmptyState
          icon={<AlertTriangle />}
          title="The recruitment dataset could not be loaded"
          description={error.message}
          action={
            <Button variant="primary" size="md" onClick={reload}>
              <RefreshCw />
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (loading || !store) return <ShellSkeleton />;

  return <>{children}</>;
}

function ShellSkeleton() {
  return (
    <div className="animate-in fade-in duration-200">
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] px-3 py-2.5 glass">
        {[132, 168, 148, 156, 140, 118].map((w, i) => (
          <Skeleton key={i} className="h-8" style={{ width: w }} />
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel p-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2.5 h-2 w-full" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="panel xl:col-span-2">
          <div className="panel-head">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="p-4">
            <Skeleton className="h-[280px] w-full" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-label text-ink-4">
        <DatabaseZap className="size-3.5" />
        Loading 28,366 application records…
      </p>
    </div>
  );
}
