"use client";

import * as React from "react";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { runFilter, statsOf, type FilterState } from "@/lib/data/query";
import { computeMetrics, groupMetrics } from "@/lib/data/metrics";
import { STAGE_INDEX, type DictField } from "@/lib/data/schema";

/**
 * Operational alerts.
 *
 * Every alert answers "what should I look at next" and carries the filter that
 * reproduces it, so an alert is never a dead end — clicking one lands the user
 * on the exact records that triggered it.
 */
export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  /** The number that triggered it, formatted for display. */
  value: string;
  href: string;
  /** Filters to apply when the user follows the alert. */
  apply?: Partial<FilterState>;
}

const MIN_SAMPLE = 60;

export function useAlerts(): Alert[] {
  const store = useStore();
  const { filters } = useFilters();

  return React.useMemo(() => {
    const rows = runFilter(store, filters);
    if (!rows.length) return [];

    const m = computeMetrics(store, rows);
    const alerts: Alert[] = [];

    /* --- Offer no-shows: accepted then never started ------------------- */
    if (m.droppedOff > 0 && m.noShowRate != null && m.noShowRate > 4) {
      alerts.push({
        id: "no-show",
        severity: m.noShowRate > 10 ? "critical" : "warning",
        title: `${m.droppedOff} accepted offers never started`,
        detail:
          "Candidates who signed and then did not appear for training. Every one is a fully-loaded sourcing and interview cost with nothing to show for it.",
        value: `${m.noShowRate.toFixed(1)}% of accepted offers`,
        href: "/attrition",
        apply: { outcomes: ["Dropped Off"] },
      });
    }

    /* --- Pipeline gone cold ------------------------------------------- */
    if (m.lapseRate != null && m.lapseRate > 38) {
      alerts.push({
        id: "lapsed",
        severity: m.lapseRate > 50 ? "critical" : "warning",
        title: `${m.lapsed.toLocaleString()} applications have gone cold`,
        detail:
          "No recorded activity for 45 days or more while still short of an offer. These are sourced, screened candidates quietly ageing out of the funnel.",
        value: `${m.lapseRate.toFixed(0)}% of intake`,
        href: "/velocity",
        apply: { outcomes: ["Lapsed"] },
      });
    }

    /* --- Contact latency ---------------------------------------------- */
    const contact = statsOf(store, rows, "d_to_call");
    if (contact.median != null && contact.median > 2) {
      alerts.push({
        id: "contact-latency",
        severity: contact.median > 5 ? "warning" : "info",
        title: "First contact is slower than target",
        detail:
          "Median days between an application arriving and the first recruiter call. Sales candidates go cold fast — every extra day costs conversion.",
        value: `${contact.median.toFixed(1)} days (target 1)`,
        href: "/velocity",
      });
    }

    /* --- Worst stage leak --------------------------------------------- */
    const leaks: { label: string; rate: number; stage: number }[] = [
      { label: "phone screen", rate: m.phoneQualifyRate ?? 100, stage: STAGE_INDEX.phone_screen },
      { label: "sales pitch", rate: m.pitchPassRate ?? 100, stage: STAGE_INDEX.sales_pitch },
      { label: "manager interview", rate: m.managerSelectRate ?? 100, stage: STAGE_INDEX.manager_interview },
    ].sort((a, b) => a.rate - b.rate);
    if (leaks[0] && leaks[0].rate < 45) {
      alerts.push({
        id: "stage-leak",
        severity: leaks[0].rate < 30 ? "warning" : "info",
        title: `The ${leaks[0].label} is the tightest gate`,
        detail:
          "The lowest pass rate in the funnel under the current filters. Worth checking whether the bar moved or the inbound mix changed.",
        value: `${leaks[0].rate.toFixed(1)}% pass rate`,
        href: "/pipeline",
        apply: { stageAtLeast: leaks[0].stage },
      });
    }

    /* --- Recruiter outliers ------------------------------------------- */
    const recruiters = groupMetrics(store, rows, "recruiter", {
      minApplications: MIN_SAMPLE,
    });
    if (recruiters.length >= 4) {
      const withRate = recruiters
        .map((r) => ({ key: r.key, v: r.metrics.overallConversion, n: r.metrics.applications }))
        .filter((r): r is { key: string; v: number; n: number } => r.v != null);
      if (withRate.length >= 4) {
        const sorted = [...withRate].sort((a, b) => a.v - b.v);
        const median = sorted[Math.floor(sorted.length / 2)].v;
        const worst = sorted[0];
        if (median > 0 && worst.v < median * 0.45) {
          alerts.push({
            id: "recruiter-outlier",
            severity: "warning",
            title: `${worst.key} is converting well below the team`,
            detail: `${worst.n.toLocaleString()} applications handled at ${worst.v.toFixed(2)}% application-to-hire, against a team median of ${median.toFixed(2)}%. Large enough a sample to be a real signal rather than noise.`,
            value: `${worst.v.toFixed(2)}% vs ${median.toFixed(2)}%`,
            href: `/recruiters/${encodeURIComponent(worst.key)}`,
          });
        }
      }
    }

    /* --- Source efficiency -------------------------------------------- */
    const sources = groupMetrics(store, rows, "source", { minApplications: 150 });
    const ranked = sources
      .map((s) => ({ key: s.key, v: s.metrics.overallConversion, n: s.metrics.applications }))
      .filter((s): s is { key: string; v: number; n: number } => s.v != null)
      .sort((a, b) => b.v - a.v);
    if (ranked.length >= 2) {
      const best = ranked[0];
      const biggest = [...sources].sort(
        (a, b) => b.metrics.applications - a.metrics.applications,
      )[0];
      if (biggest && best.key !== biggest.key) {
        const biggestRate = biggest.metrics.overallConversion ?? 0;
        if (best.v > biggestRate * 1.6) {
          alerts.push({
            id: "source-mix",
            severity: "info",
            title: `${best.key} converts ${(best.v / Math.max(biggestRate, 0.01)).toFixed(1)}× better than ${biggest.key}`,
            detail: `${biggest.key} supplies the most volume (${biggest.metrics.applications.toLocaleString()} applications) but ${best.key} turns a far higher share into hires. Shifting effort is the cheapest conversion win available.`,
            value: `${best.v.toFixed(2)}% vs ${biggestRate.toFixed(2)}%`,
            href: "/sources",
          });
        }
      }
    }

    /* --- Joining-date slippage ---------------------------------------- */
    const slip = statsOf(store, rows, "doj_slip");
    if (slip.count >= 30 && slip.median != null && slip.median > 2) {
      alerts.push({
        id: "doj-slip",
        severity: "info",
        title: "Start dates are slipping past plan",
        detail:
          "Median gap between the planned joining date and the actual one. Slippage compounds into headcount plans and training cohort sizes.",
        value: `${slip.median.toFixed(1)} days late`,
        href: "/velocity",
      });
    }

    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [store, filters]);
}

export type { DictField };
