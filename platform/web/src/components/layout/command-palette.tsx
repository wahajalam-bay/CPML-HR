"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowRight,
  Bookmark,
  Filter,
  Moon,
  Search,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn, fmtInt, slugify } from "@/lib/utils";
import { NAV, visibleNav } from "@/lib/navigation";
import { useSession } from "@/lib/providers/session-provider";
import { useStoreState } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { DIMENSIONS, type DictField } from "@/lib/data/schema";

/**
 * Command palette.
 *
 * Three kinds of result share one list: pages to open, dimension values to
 * filter by, and saved views to restore. Candidates are deliberately excluded
 * from the default list — 28k names would drown everything else — and only
 * appear once the query is specific enough to be a name lookup.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { store } = useStoreState();
  const { session } = useSession();
  const { drillTo, savedViews, deleteView, reset } = useFilters();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = React.useState("");

  const pages = React.useMemo(() => visibleNav(session.role), [session.role]);

  const dimensionMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!store || q.length < 2) return [];
    const out: { field: DictField; label: string; value: string }[] = [];
    for (const dim of DIMENSIONS) {
      if (!dim.filterable) continue;
      for (const value of store.dicts[dim.field] ?? []) {
        if (value.toLowerCase().includes(q)) {
          out.push({ field: dim.field, label: dim.label, value });
          if (out.length >= 24) return out;
        }
      }
    }
    return out;
  }, [store, query]);

  const candidateMatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!store || q.length < 3) return [];
    const out: { id: number; name: string; phone: string }[] = [];
    for (let i = 0; i < store.searchIndex.length && out.length < 8; i++) {
      if (store.searchIndex[i].includes(q)) {
        out.push({ id: i, name: store.names[i], phone: store.phones[i] });
      }
    }
    return out;
  }, [store, query]);

  const go = React.useCallback(
    (href: string) => {
      router.push(href);
      onOpenChange(false);
      setQuery("");
    },
    [router, onOpenChange],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        aria-label="Close command palette"
        className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      <Command
        label="Command palette"
        shouldFilter={false}
        loop
        className="absolute left-1/2 top-[12vh] w-[calc(100vw-2rem)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-[var(--r-lg)] border border-line bg-overlay shadow-[var(--sh-3)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") onOpenChange(false);
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-ink-4" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages, recruiters, sources, candidates…"
            className="w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-4"
          />
          <kbd className="shrink-0 rounded-[4px] border border-line px-1.5 py-0.5 text-micro text-ink-4">
            Esc
          </kbd>
        </div>

        <Command.List className="max-h-[62vh] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-10 text-center text-meta text-ink-4">
            Nothing matches “{query}”.
          </Command.Empty>

          <Group heading="Pages">
            {pages
              .filter((p) =>
                query.trim()
                  ? `${p.label} ${p.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
                  : true,
              )
              .map((p) => {
                const Icon = p.icon;
                return (
                  <Item key={p.href} onSelect={() => go(p.href)}>
                    <Icon className="size-3.5 shrink-0 text-ink-3" />
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="hidden truncate text-label text-ink-4 sm:block">
                      {p.purpose}
                    </span>
                  </Item>
                );
              })}
          </Group>

          {dimensionMatches.length ? (
            <Group heading="Filter by">
              {dimensionMatches.map((m) => (
                <Item
                  key={`${m.field}:${m.value}`}
                  onSelect={() => {
                    drillTo(m.field, m.value);
                    onOpenChange(false);
                    setQuery("");
                    toast(`Filtered to ${m.label}: ${m.value}`);
                  }}
                >
                  <Filter className="size-3.5 shrink-0 text-ink-3" />
                  <span className="flex-1 truncate">{m.value}</span>
                  <span className="shrink-0 text-label text-ink-4">{m.label}</span>
                </Item>
              ))}
            </Group>
          ) : null}

          {candidateMatches.length ? (
            <Group heading="Candidates">
              {candidateMatches.map((c) => (
                <Item
                  key={c.id}
                  onSelect={() => go(`/candidates?focus=${c.id}`)}
                >
                  <User className="size-3.5 shrink-0 text-ink-3" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-label tabular-nums text-ink-4">
                    {c.phone || "—"}
                  </span>
                </Item>
              ))}
            </Group>
          ) : null}

          {savedViews.length ? (
            <Group heading="Saved views">
              {savedViews.slice(0, 8).map((v) => (
                <Item
                  key={v.id}
                  onSelect={() => go(v.query ? `${v.path}?${v.query}` : v.path)}
                >
                  <Bookmark className="size-3.5 shrink-0 text-ink-3" />
                  <span className="flex-1 truncate">{v.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete saved view ${v.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteView(v.id);
                      toast(`Deleted “${v.name}”`);
                    }}
                    className="shrink-0 text-ink-4 hover:text-critical"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </Item>
              ))}
            </Group>
          ) : null}

          <Group heading="Actions">
            <Item
              onSelect={() => {
                reset();
                onOpenChange(false);
                toast("Cleared all filters");
              }}
            >
              <Filter className="size-3.5 shrink-0 text-ink-3" />
              <span className="flex-1">Clear all filters</span>
            </Item>
            <Item
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                onOpenChange(false);
              }}
            >
              {resolvedTheme === "dark" ? (
                <Sun className="size-3.5 shrink-0 text-ink-3" />
              ) : (
                <Moon className="size-3.5 shrink-0 text-ink-3" />
              )}
              <span className="flex-1">
                Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
              </span>
            </Item>
          </Group>
        </Command.List>

        <footer className="flex items-center justify-between border-t border-line px-3 py-1.5 text-micro text-ink-4">
          <span>
            {store ? `${fmtInt(store.meta.rowCount)} applications indexed` : "Loading dataset…"}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded-[3px] border border-line px-1">↑↓</kbd> navigate
            <kbd className="rounded-[3px] border border-line px-1">↵</kbd> open
          </span>
        </footer>
      </Command>
    </div>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  className,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--r-xs)] px-2 py-1.5 text-meta text-ink-2",
        "data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink",
        className,
      )}
    >
      {children}
      <ArrowRight className="size-3 shrink-0 text-ink-4 opacity-0 data-[selected=true]:opacity-100" />
    </Command.Item>
  );
}

/** Global ⌘K / Ctrl-K binding plus the `g`-prefixed go-to shortcuts. */
export function usePaletteShortcuts(onOpen: () => void) {
  const router = useRouter();
  React.useEffect(() => {
    let pendingGo = false;
    let goTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
        return;
      }
      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        onOpen();
        return;
      }

      if (pendingGo) {
        pendingGo = false;
        if (goTimer) clearTimeout(goTimer);
        const map: Record<string, string> = {
          h: "/", e: "/health", p: "/pipeline", v: "/velocity", l: "/attrition",
          r: "/recruiters", s: "/sources", t: "/talent", c: "/candidates",
        };
        const href = map[e.key.toLowerCase()];
        if (href) {
          e.preventDefault();
          router.push(href);
        }
        return;
      }

      if (e.key.toLowerCase() === "g") {
        pendingGo = true;
        goTimer = setTimeout(() => { pendingGo = false; }, 1200);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (goTimer) clearTimeout(goTimer);
    };
  }, [onOpen, router]);
}

export { slugify, NAV };
