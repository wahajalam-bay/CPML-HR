"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS, visibleNav, type NavItem } from "@/lib/navigation";
import { useSession } from "@/lib/providers/session-provider";
import { Hint } from "@/components/ui/overlays";

const COLLAPSE_KEY = "cpml.sidebar.collapsed";

export function Sidebar({
  onOpenPalette,
}: {
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();
  const { session } = useSession();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const items = React.useMemo(() => visibleNav(session.role), [session.role]);
  const grouped = React.useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        section,
        items: items.filter((i) => i.section === section),
      })).filter((g) => g.items.length),
    [items],
  );

  return (
    <nav
      aria-label="Primary"
      data-collapsed={collapsed}
      className={cn(
        "no-print sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 lg:flex",
        collapsed ? "w-[52px]" : "w-[212px]",
      )}
    >
      {/* The brand row carries the green rather than sitting plain white beside
          a deep green header. A tint, not a slab: the sidebar's job is to let
          the active item stand out, and a solid green band here would compete
          with it. */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-line bg-g6",
          collapsed ? "justify-center px-0" : "gap-2 px-3",
        )}
      >
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2"
          aria-label="CPML HR — home"
        >
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold tracking-tight text-white shadow-[var(--sh-1)]"
            style={{ background: "var(--grad-green)" }}
          >
            CP
          </span>
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block truncate text-meta font-semibold leading-tight text-ink">
                CPML HR
              </span>
              <span className="block truncate text-micro leading-tight text-ink-3">
                Recruitment Operations
              </span>
            </span>
          ) : null}
        </Link>
      </div>

      <div className={cn("shrink-0 px-2 py-2", collapsed && "px-1.5")}>
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            "flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-2 text-label text-ink-3 transition-colors hover:border-line-2 hover:text-ink-2",
            collapsed ? "h-7 justify-center px-0" : "h-7 px-2",
          )}
          aria-label="Open command palette"
        >
          <Command className="size-3.5 shrink-0" />
          {!collapsed ? (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded-[3px] border border-line bg-surface px-1 text-micro text-ink-4">
                ⌘K
              </kbd>
            </>
          ) : null}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {grouped.map((group) => (
          <div key={group.section} className="mb-3">
            {!collapsed ? (
              <div className="eyebrow px-2 pb-1 pt-1">{group.section}</div>
            ) : (
              <div className="mx-auto my-2 h-px w-5 bg-line" aria-hidden />
            )}
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href)
                  }
                  collapsed={collapsed}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-line p-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-7 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-label text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <ChevronsRight className="size-3.5" />
          ) : (
            <>
              <ChevronsLeft className="size-3.5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-7 items-center gap-2 rounded-[var(--radius-control)] text-meta transition-colors",
        collapsed ? "justify-center px-0" : "px-2",
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-3")} />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  return (
    <li>
      {collapsed ? (
        <Hint content={item.label} side="right">
          {link}
        </Hint>
      ) : (
        <Hint content={item.purpose} side="right">
          {link}
        </Hint>
      )}
    </li>
  );
}

/* =========================================================================
 * Mobile navigation — the same map in a sheet
 * ========================================================================= */

export function MobileNav({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { session } = useSession();
  const items = visibleNav(session.role);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        aria-label="Close navigation"
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
      />
      <nav
        aria-label="Primary"
        className="absolute inset-y-0 left-0 flex w-[248px] flex-col border-r border-line bg-surface"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-[5px] bg-accent text-[11px] font-bold text-accent-fg"
          >
            CP
          </span>
          <span className="text-meta font-semibold text-ink">CPML HR</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {NAV_SECTIONS.map((section) => {
            const group = items.filter((i) => i.section === section);
            if (!group.length) return null;
            return (
              <div key={section} className="mb-3">
                <div className="eyebrow px-2 pb-1">{section}</div>
                <ul className="flex flex-col gap-px">
                  {group.map((item) => {
                    const Icon = item.icon;
                    const active =
                      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-body",
                            active
                              ? "bg-accent-soft font-medium text-accent"
                              : "text-ink-2 hover:bg-surface-2",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-ink-3" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
