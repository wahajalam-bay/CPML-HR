"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { cn, fmtPct } from "@/lib/utils";
import { Panel, PanelHeader, Badge } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/overlays";
import { healthScore, type Metrics } from "@/lib/data/metrics";
import { useBaselineMetrics } from "@/lib/hooks/use-analytics";
import type { Selection } from "@/lib/data/schema";

const BAND_UI = {
  strong: { tone: "top" as const, color: "var(--q-top)", icon: "★", label: "Strong" },
  healthy: { tone: "good" as const, color: "var(--q-good)", icon: "▲", label: "Healthy" },
  watch: { tone: "serious" as const, color: "var(--q-low)", icon: "▽", label: "Watch" },
  "at-risk": { tone: "critical" as const, color: "var(--q-crit)", icon: "▼", label: "At risk" },
};

/**
 * Recruitment health as a single comparable number.
 *
 * Scored against the organisation's own all-time baseline rather than an
 * arbitrary target, so 100 means "twice as good as CPML normally performs"
 * and 62 means "about normal" — a figure that stays meaningful when the
 * filter changes.
 */
export function HealthGauge({
  rows,
  metrics,
  className,
}: {
  rows: Selection;
  metrics: Metrics;
  className?: string;
}) {
  const baseline = useBaselineMetrics();
  const health = React.useMemo(() => healthScore(metrics, baseline), [metrics, baseline]);
  const ui = BAND_UI[health.band];

  const R = 62;
  const CIRC = Math.PI * R; // half-doughnut
  const filled = (health.score / 100) * CIRC;

  return (
    <Panel className={cn("flex flex-col overflow-hidden", className)}>
      <PanelHeader
        title="Recruitment health"
        description="Weighted against CPML's own all-time baseline"
        actions={
          <Badge tone={ui.tone} size="md">
            <span aria-hidden>{ui.icon}</span>
            {ui.label}
          </Badge>
        }
      />

      <div className="flex flex-col items-center px-4 pb-1 pt-4">
        <svg width="180" height="102" viewBox="0 0 180 102" aria-hidden className="overflow-visible">
          <path
            d={`M 28 90 A ${R} ${R} 0 0 1 152 90`}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d={`M 28 90 A ${R} ${R} 0 0 1 152 90`}
            fill="none"
            stroke={ui.color}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRC}`}
            style={{ transition: "stroke-dasharray 900ms cubic-bezier(.16,1,.3,1)" }}
          />
          <text
            x="90"
            y="80"
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 34, fontWeight: 800 }}
          >
            {health.score}
          </text>
          <text x="90" y="97" textAnchor="middle" className="fill-ink-3" style={{ fontSize: 10 }}>
            out of 100
          </text>
        </svg>
        <p className="mt-1 text-center text-label leading-[1.55] text-ink-3">
          {rows.length.toLocaleString()} applications scored across six weighted measures.
        </p>
      </div>

      <div className="mt-1 border-t border-line">
        {health.contributions.map((c) => {
          const share = c.weight ? (c.scaled / c.weight) * 100 : 0;
          return (
            <Hint
              key={c.label}
              content={`Contributes ${c.weight}% of the score. Currently at ${share.toFixed(0)}% of the maximum for this component.`}
            >
              <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-1.5 last:border-0">
                <span className="w-[42%] shrink-0 truncate text-label text-ink-2">
                  {c.label}
                </span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.min(100, share)}%`,
                      background: share >= 62 ? "var(--q-good)" : share >= 45 ? "var(--q-mid)" : "var(--q-low)",
                      transition: "width 900ms cubic-bezier(.16,1,.3,1)",
                    }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-label font-bold tabular-nums text-ink">
                  {c.weight}%
                </span>
              </div>
            </Hint>
          );
        })}
      </div>

      <footer className="flex items-center gap-1.5 border-t border-line px-3.5 py-2 text-micro text-ink-4">
        <ShieldCheck className="size-3 shrink-0" />
        <span>
          Baseline: {fmtPct(baseline.overallConversion, 2)} application-to-hire across all{" "}
          {baseline.applications.toLocaleString()} records.
        </span>
      </footer>
    </Panel>
  );
}
