"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  Check,
  Download,
  Menu,
  Moon,
  LogOut,
  Presentation,
  RefreshCw,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn, initials } from "@/lib/utils";
import { NAV } from "@/lib/navigation";
import { useSession } from "@/lib/providers/session-provider";
import { useStoreState } from "@/lib/providers/store-provider";
import { signOut } from "@/server/auth/actions";
import { Badge } from "@/components/ui/primitives";
import { ROLES, type Role } from "@/lib/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
} from "@/components/ui/overlays";

/**
 * The application header.
 *
 * Glass + brand gradient, per design system §5.4 — one of the three surfaces
 * where glassmorphism is permitted. Holds search, alerts, export, refresh,
 * presentation mode, theme and profile.
 */
export function AppHeader({
  onOpenPalette,
  onOpenMobileNav,
  alertCount = 0,
  onOpenAlerts,
  recruiters = [],
}: {
  onOpenPalette: () => void;
  onOpenMobileNav: () => void;
  alertCount?: number;
  onOpenAlerts?: () => void;
  /** Recruiter names available to bind a scoped session to. */
  recruiters?: string[];
}) {
  const pathname = usePathname();
  const { session, setRole } = useSession();
  const { reload } = useStoreState();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [presenting, setPresenting] = React.useState(false);
  const signOutFormRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => setMounted(true), []);

  const current = React.useMemo(() => {
    const exact = NAV.find((n) => n.href === pathname);
    if (exact) return exact;
    return NAV.filter((n) => n.href !== "/").find((n) => pathname.startsWith(n.href));
  }, [pathname]);

  const togglePresentation = React.useCallback(() => {
    setPresenting((p) => {
      const next = !p;
      document.body.dataset.presentation = next ? "true" : "false";
      if (next) toast("Presentation mode — press Esc to exit");
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPresenting(false);
        document.body.dataset.presentation = "false";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  return (
    <header
      className="no-print sticky top-0 z-50 mb-4 overflow-hidden rounded-[var(--r-lg)] border border-white/15 shadow-[var(--sh-3)]"
      style={{ background: "var(--grad-header)" }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5 backdrop-blur-[6px] sm:px-4">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-white/25 bg-white/12 text-white/90 transition-colors hover:bg-white/25 lg:hidden"
        >
          <Menu className="size-4" />
        </button>

        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-[11px] text-[13px] font-extrabold text-[#063d24] shadow-[0_4px_12px_rgb(0_0_0/0.25),inset_0_0_0_1px_rgb(255_255_255/0.6)]"
            style={{ background: "linear-gradient(135deg,#fff,#d8f0e2)" }}
          >
            CP
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-[15px] font-extrabold leading-tight tracking-[0.2px] text-white">
              {current?.label ?? "Command Center"}
            </span>
            <span className="block truncate text-[10px] font-semibold uppercase leading-tight tracking-[0.6px] text-white/70">
              CPML HR · Recruitment Operations
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={onOpenPalette}
          className="ml-1 flex h-9 max-w-[320px] flex-1 items-center gap-2 rounded-[var(--r-pill)] border border-white/22 bg-white/14 px-3 text-white/70 transition-colors hover:bg-white/22"
          aria-label="Search candidates, recruiters and pages"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden flex-1 text-left text-meta sm:block">
            Search candidates, recruiters, pages…
          </span>
          <kbd className="ml-auto hidden rounded-[4px] border border-white/25 px-1 text-micro text-white/70 sm:block">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <IconButton
            label={`Alerts${alertCount ? ` — ${alertCount} needing attention` : ""}`}
            onClick={onOpenAlerts}
            badge={alertCount > 0}
          >
            <Bell className="size-[18px]" />
          </IconButton>

          <IconButton
            label="Refresh dataset"
            onClick={() => {
              reload();
              toast.success("Reloading dataset from source");
            }}
            className="hidden sm:grid"
          >
            <RefreshCw className="size-[18px]" />
          </IconButton>

          <IconButton
            label="Print or export this view"
            onClick={() => window.print()}
            className="hidden sm:grid"
          >
            <Download className="size-[18px]" />
          </IconButton>

          <IconButton
            label={presenting ? "Exit presentation mode" : "Presentation mode"}
            onClick={togglePresentation}
            active={presenting}
            className="hidden md:grid"
          >
            <Presentation className="size-[18px]" />
          </IconButton>

          <IconButton
            label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun className="size-[18px]" />
            ) : (
              <Moon className="size-[18px]" />
            )}
          </IconButton>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account and role"
                className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-white/40 text-[12px] font-bold text-white shadow-[0_3px_8px_rgb(0_0_0/0.25)]"
                style={{ background: "linear-gradient(135deg,#27a96d,#0a5c3d)" }}
              >
                {initials(session.name)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-[228px]">
              <div className="px-2 py-1.5">
                <p className="truncate text-body font-semibold text-ink">{session.name}</p>
                <p className="truncate text-label text-ink-3">{session.email}</p>
              </div>
              <DropdownMenuSeparator />
              {session.simulated ? (
                <>
                  <DropdownMenuLabel>View as role</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                value={session.role}
                onValueChange={(value) => {
                  const role = value as Role;
                  // A Recruiter is scoped to a book, so switching to that role
                  // has to bind an identity — otherwise the session is
                  // correctly, but uselessly, scoped to nothing.
                  const key =
                    role === "Recruiter" ? (recruiters[0] ?? null) : null;
                  setRole(role, key);
                  toast(
                    key ? `Viewing as ${role} — ${key}'s book` : `Viewing as ${role}`,
                  );
                }}
              >
                {ROLES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={r}>
                    {r}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              {session.role === "Recruiter" && recruiters.length ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Whose book</DropdownMenuLabel>
                  <div className="max-h-[220px] overflow-y-auto">
                    <DropdownMenuRadioGroup
                      value={session.recruiterKey ?? ""}
                      onValueChange={(key) => {
                        setRole("Recruiter", key);
                        toast(`Scoped to ${key}'s book`);
                      }}
                    >
                      {recruiters.map((r) => (
                        <DropdownMenuRadioItem key={r} value={r}>
                          {r}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </div>
                </>
              ) : null}
                </>
              ) : (
                <div className="px-2 pb-1.5">
                  <Badge tone="good" size="md">
                    <span aria-hidden>▲</span>
                    {session.role}
                  </Badge>
                  <p className="mt-1.5 text-micro leading-[1.5] text-ink-4">
                    Your role is set by your account and cannot be changed here.
                    Ask an administrator if it is wrong.
                  </p>
                </div>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.print()}>
                <Download />
                Print current view
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/reports">
                  <UserRound />
                  Reports &amp; exports
                </Link>
              </DropdownMenuItem>

              {!session.simulated ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      // A form post, not a fetch: sign-out is a state change
                      // and must go through the same origin check as every
                      // other mutation.
                      signOutFormRef.current?.requestSubmit();
                    }}
                  >
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Kept outside the menu: Radix unmounts its content on select, which
              would tear down the form before it could submit. */}
          <form ref={signOutFormRef} action={signOut} className="hidden" />
        </div>
      </div>
    </header>
  );
}

function IconButton({
  children,
  label,
  onClick,
  badge,
  active,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  badge?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <Hint content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-[11px] border transition-all duration-200",
          active
            ? "border-white/60 bg-white/30 text-white"
            : "border-white/24 bg-white/12 text-white/90 hover:-translate-y-px hover:bg-white/24",
          className,
        )}
      >
        {children}
        {badge ? (
          <span
            aria-hidden
            className="absolute right-2 top-1.5 size-2 rounded-full bg-[#ffd24a] shadow-[0_0_0_2px_#063d24]"
          />
        ) : null}
      </button>
    </Hint>
  );
}

export { Check };
