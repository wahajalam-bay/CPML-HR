"use client";

import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section head — icon chip, title, one-line purpose (design system §5). */
export function SectionHead({
  icon: Icon,
  title,
  description,
  actions,
  className,
  id,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn("mb-3 flex items-center gap-2.5 px-0.5", className)}>
      {Icon ? (
        <span
          aria-hidden
          className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-g6 text-g1"
        >
          <Icon className="size-[17px]" />
        </span>
      ) : null}
      <div className="min-w-0">
        <h2 className="truncate text-title font-extrabold tracking-[0.2px] text-ink">
          {title}
        </h2>
        {description ? (
          <p className="truncate text-meta font-medium text-ink-3">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 no-print">{actions}</div>
      ) : null}
    </div>
  );
}

/** Page title block with breadcrumb trail. */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: {
  title: string;
  description?: string;
  breadcrumb?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-4", className)}>
      {breadcrumb?.length ? (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-meta">
          {breadcrumb.map((crumb, i) => (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? (
                <ChevronRight className="size-3 shrink-0 text-ink-4" aria-hidden />
              ) : null}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="rounded-[5px] px-1 py-0.5 font-semibold text-g1 transition-colors hover:bg-g6"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="px-1 font-bold text-ink">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-extrabold tracking-[0.2px] text-ink">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-meta text-ink-3">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5 no-print">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/** Consistent vertical rhythm between sections (design system §4: 34px). */
export function Section({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("mb-[34px] last:mb-0", className)} {...props} />;
}
