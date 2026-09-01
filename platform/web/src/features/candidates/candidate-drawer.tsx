"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CircleDashed,
  Copy,
  GraduationCap,
  Minus,
  Phone,
  UserCog,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  cn,
  fmtDay,
  fmtInt,
  fmtSalary,
  fmtYears,
  initials,
} from "@/lib/utils";
import { Drawer } from "@/components/ui/overlays";
import { Badge, StatusDot, Separator } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { StatRow } from "@/components/metrics/metric-card";
import { ordinalColor } from "@/components/charts/chart-kit";
import { useStore } from "@/lib/providers/store-provider";
import { useSession } from "@/lib/providers/session-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { ProtectedValue } from "@/components/auth/guards";
import {
  NULL_NUM,
  OUTCOME_MEANING,
  OUTCOME_TONE,
  STAGES,
  STAGE_DATE,
  type DictField,
  type Outcome,
} from "@/lib/data/schema";

/**
 * Candidate record.
 *
 * The timeline is the point of this view: it reconstructs the candidate's
 * actual journey from the dated stage columns, so a recruiter can see not
 * just where someone stopped but how long each step took and what was
 * recorded at it.
 */
export function CandidateDrawer({
  row,
  onClose,
  onNavigate,
}: {
  row: number | null;
  onClose: () => void;
  onNavigate?: (direction: "next" | "prev") => void;
}) {
  const store = useStore();
  const { drillTo } = useFilters();
  // Hooks must run before the `row == null` early return below, or the hook
  // order changes between an open drawer and a closed one.
  const { canSeeField, audit } = useSession();

  React.useEffect(() => {
    if (row != null) audit("record.viewed", `candidate:${row}`);
  }, [row, audit]);

  const record = React.useMemo(() => {
    if (row == null) return null;

    const dim = (field: DictField) => {
      const idx = store.cols[field][row];
      return idx < 0 ? null : store.dicts[field][idx];
    };
    const date = (field: keyof typeof store.cols) => {
      const d = store.cols[field][row];
      return d < 0 ? null : d;
    };
    const num = (field: keyof typeof store.cols, scale = 1) => {
      const v = store.cols[field][row];
      return v === NULL_NUM ? null : v * scale;
    };

    const stageReached = store.cols.stage_reached[row];
    const stagePassed = store.cols.stage_passed[row];

    const timeline = STAGES.map((stage, i) => {
      const dateField = STAGE_DATE[stage.key];
      const at = dateField ? date(dateField) : null;
      const reached = stageReached >= i;
      const passed = ((stagePassed >> i) & 1) === 1;
      return { ...stage, index: i, at, reached, passed };
    });

    return {
      name: store.names[row],
      phone: store.phones[row],
      outcome: store.meta.outcomes[store.cols.outcome[row]] as Outcome,
      isRepeat: store.cols.is_repeat[row] === 1,
      stageReached,
      timeline,
      dim,
      date,
      num,
    };
  }, [row, store]);

  if (row == null || !record) return null;

  const canSeePhone = canSeeField("phone");

  const copy = (text: string, label: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`${label} copied`))
      .catch(() => toast.error("Could not copy to clipboard"));
  };

  const recruiter = record.dim("recruiter");
  const salary = record.num("current_salary", 500);
  const experience = record.num("experience_years", 0.1);
  const idle = record.num("days_idle");

  return (
    <Drawer
      open={row != null}
      onOpenChange={(open) => !open && onClose()}
      width={600}
      title={
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-g6 text-[11px] font-extrabold text-g1"
          >
            {initials(record.name)}
          </span>
          <span className="min-w-0 truncate">{record.name}</span>
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusDot tone={OUTCOME_TONE[record.outcome] ?? "neutral"} />
          {record.outcome}
          <span className="text-ink-4">·</span>
          Reached {STAGES[record.stageReached]?.label}
          {record.isRepeat ? (
            <>
              <span className="text-ink-4">·</span>
              <span>Re-applicant</span>
            </>
          ) : null}
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-micro text-ink-4">
            {OUTCOME_MEANING[record.outcome]}
          </span>
          {onNavigate ? (
            <span className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous record" onClick={() => onNavigate("prev")}>
                <ArrowLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next record" onClick={() => onNavigate("next")}>
                <ArrowRight />
              </Button>
            </span>
          ) : null}
        </div>
      }
    >
      <div className="p-4">
        {/* ---- Quick actions ---- */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {canSeePhone && record.phone ? (
            <Button variant="default" size="sm" onClick={() => copy(record.phone, "Phone number")}>
              <Phone />
              {record.phone}
              <Copy className="!size-3 text-ink-4" />
            </Button>
          ) : null}
          {recruiter ? (
            <Button variant="default" size="sm" asChild>
              <Link href={`/recruiters/${encodeURIComponent(recruiter)}`}>
                <UserCog />
                {recruiter}
              </Link>
            </Button>
          ) : null}
        </div>

        {/* ---- Timeline ---- */}
        <section className="mb-5">
          <h3 className="eyebrow mb-2">Journey</h3>
          <ol className="relative">
            {record.timeline.map((stage, i) => {
              const previous = record.timeline
                .slice(0, i)
                .reverse()
                .find((s) => s.at != null);
              const gap =
                stage.at != null && previous?.at != null ? stage.at - previous.at : null;
              const isLast = i === record.timeline.length - 1;
              const state = !stage.reached
                ? "pending"
                : stage.passed
                  ? "passed"
                  : i === record.stageReached
                    ? "stopped"
                    : "reached";

              return (
                <li key={stage.key} className="relative flex gap-3 pb-3 last:pb-0">
                  {!isLast ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-[11px] top-6 h-[calc(100%-16px)] w-px",
                        stage.reached ? "bg-g4" : "bg-line",
                      )}
                    />
                  ) : null}

                  <span
                    aria-hidden
                    className={cn(
                      "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2",
                      state === "passed" && "border-transparent text-white",
                      state === "stopped" && "border-critical bg-critical-soft text-critical-ink",
                      state === "reached" && "border-g4 bg-surface text-g1",
                      state === "pending" && "border-line bg-surface text-ink-4",
                    )}
                    style={
                      state === "passed"
                        ? { background: ordinalColor(i, STAGES.length) }
                        : undefined
                    }
                  >
                    {state === "passed" ? (
                      <Check className="size-3" strokeWidth={3.5} />
                    ) : state === "stopped" ? (
                      <X className="size-3" strokeWidth={3.5} />
                    ) : state === "reached" ? (
                      <CircleDashed className="size-3" />
                    ) : (
                      <Minus className="size-3" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p
                        className={cn(
                          "text-meta font-semibold",
                          stage.reached ? "text-ink" : "text-ink-4",
                        )}
                      >
                        {stage.label}
                      </p>
                      <p className="text-label tabular-nums text-ink-3">
                        {stage.at != null ? fmtDay(stage.at) : state === "pending" ? "—" : "no date recorded"}
                        {gap != null && gap > 0 ? (
                          <span className="ml-1.5 text-ink-4">+{gap}d</span>
                        ) : null}
                      </p>
                    </div>
                    {state === "stopped" ? (
                      <p className="mt-0.5 text-label text-critical-ink">
                        Journey ended here
                        {record.dim("loss_reason") ? ` — ${record.dim("loss_reason")}` : ""}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <Separator className="mb-4" />

        {/* ---- Detail sections ---- */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <DetailSection title="Sourcing" icon={<Building2 className="size-3.5" />}>
            <StatRow label="Source" value={<Drill field="source" value={record.dim("source")} onDrill={drillTo} />} />
            <StatRow label="Channel" value={record.dim("channel") ?? "—"} />
            <StatRow label="Recruiter" value={<Drill field="recruiter" value={recruiter} onDrill={drillTo} />} />
            <StatRow label="Role applied" value={<Drill field="applied_role" value={record.dim("applied_role")} onDrill={drillTo} />} />
            <StatRow label="Campaign" value={record.dim("drive") ?? "—"} />
            <StatRow label="City" value={record.dim("city") ?? "—"} />
          </DetailSection>

          <DetailSection title="Background" icon={<GraduationCap className="size-3.5" />}>
            <StatRow label="Experience" value={experience != null ? fmtYears(experience) : "—"} />
            <StatRow label="Education" value={<Drill field="degree" value={record.dim("degree")} onDrill={drillTo} />} />
            <StatRow label="Institute" value={<Drill field="institute" value={record.dim("institute")} onDrill={drillTo} />} />
            <StatRow label="Prior industry" value={<Drill field="industry" value={record.dim("industry")} onDrill={drillTo} />} />
            <StatRow
              label="Last drawn salary"
              value={
                <ProtectedValue field="salary">
                  {salary != null ? fmtSalary(salary) : "—"}
                </ProtectedValue>
              }
              hint="Parsed from free text in the source sheet."
            />
          </DetailSection>

          <DetailSection title="Assessment" icon={<Check className="size-3.5" />}>
            <StatRow label="Screening" value={record.dim("screen_status") ?? "—"} />
            <StatRow label="Call outcome" value={record.dim("call_status") ?? "—"} />
            <StatRow label="Assessment" value={record.dim("assessment_status") ?? "—"} />
            <StatRow
              label="Sales pitch"
              value={
                record.dim("sp_status") ? (
                  <Badge tone={record.dim("sp_status") === "SP+" ? "good" : "neutral"}>
                    {record.dim("sp_status")}
                  </Badge>
                ) : (
                  "—"
                )
              }
            />
            <StatRow label="Manager interview" value={record.dim("manager_status") ?? "—"} />
            <StatRow label="Final interview" value={record.dim("final_status") ?? "—"} />
          </DetailSection>

          <DetailSection title="Decision" icon={<CalendarDays className="size-3.5" />}>
            <StatRow label="Hiring manager" value={<Drill field="hiring_manager" value={record.dim("hiring_manager")} onDrill={drillTo} />} />
            <StatRow label="Director panel" value={record.dim("director") ?? "—"} />
            <StatRow label="Offer status" value={record.dim("offer_status") ?? "—"} />
            <StatRow label="Role hired" value={record.dim("hired_role") ?? "—"} />
            <StatRow label="Business unit" value={<Drill field="team" value={record.dim("team")} onDrill={drillTo} />} />
            <StatRow label="Final status" value={record.dim("outcome_status") ?? "—"} />
          </DetailSection>

          <DetailSection title="Timing" icon={<CalendarDays className="size-3.5" />}>
            <StatRow label="Applied" value={fmtDay(record.date("applied_date"))} />
            <StatRow label="Planned start" value={fmtDay(record.date("planned_doj"))} />
            <StatRow label="Actual start" value={fmtDay(record.date("actual_doj"))} />
            <StatRow
              label="Time to hire"
              value={record.num("time_to_hire") != null ? `${fmtInt(record.num("time_to_hire"))} days` : "—"}
            />
            <StatRow
              label="Days idle"
              value={
                idle != null ? (
                  <span className={idle > 45 ? "text-serious-ink" : undefined}>
                    {fmtInt(idle)}
                  </span>
                ) : (
                  "—"
                )
              }
              hint="Since the last recorded activity on this record."
            />
          </DetailSection>

          <DetailSection title="Outcome" icon={<CircleDashed className="size-3.5" />}>
            <StatRow
              label="Result"
              value={
                <span className="flex items-center justify-end gap-1.5">
                  <StatusDot tone={OUTCOME_TONE[record.outcome] ?? "neutral"} />
                  {record.outcome}
                </span>
              }
            />
            <StatRow label="Exit stage" value={record.dim("exit_stage") ? STAGES.find((s) => s.key === record.dim("exit_stage"))?.label ?? "—" : "—"} />
            <StatRow label="Loss category" value={<Drill field="loss_category" value={record.dim("loss_category")} onDrill={drillTo} />} />
            <StatRow label="Loss reason" value={<Drill field="loss_reason" value={record.dim("loss_reason")} onDrill={drillTo} />} />
          </DetailSection>
        </div>
      </div>
    </Drawer>
  );
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="eyebrow mb-1 flex items-center gap-1.5">
        <span className="text-ink-4">{icon}</span>
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

/** A value that filters the whole platform to itself when clicked. */
function Drill({
  field,
  value,
  onDrill,
}: {
  field: DictField;
  value: string | null;
  onDrill: (field: DictField, value: string) => void;
}) {
  if (!value) return <span className="text-ink-4">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        onDrill(field, value);
        toast(`Filtered to ${value}`);
      }}
      className="max-w-[200px] truncate text-right font-medium text-g1 transition-colors hover:underline"
      title={`Filter the platform to ${value}`}
    >
      {value}
    </button>
  );
}
