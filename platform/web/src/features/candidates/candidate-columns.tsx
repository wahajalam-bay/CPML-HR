"use client";

import * as React from "react";
import { fmtDay, fmtInt, fmtSalary } from "@/lib/utils";
import { Badge, StatusDot } from "@/components/ui/primitives";
import { ordinalColor } from "@/components/charts/chart-kit";
import {
  NULL_NUM,
  OUTCOME_TONE,
  STAGES,
  type DateField,
  type DictField,
  type NumField,
  type Outcome,
  type RecruitmentStore,
} from "@/lib/data/schema";
import { canSeeField, type ProtectedField, type Role } from "@/lib/auth/permissions";

/**
 * Column definitions for the candidate explorer.
 *
 * Each column reads straight out of the columnar store by row index — no row
 * objects are ever materialised, which is what keeps a 28,000-row table
 * responsive while every cell stays sortable and exportable.
 */
export interface CandidateColumn {
  id: string;
  header: string;
  /** Sortable/exportable primitive. */
  value: (store: RecruitmentStore, row: number) => string | number | null;
  /** Rich cell. Falls back to the raw value. */
  render?: (store: RecruitmentStore, row: number) => React.ReactNode;
  width: number;
  align?: "left" | "right";
  /** Protected field this column exposes, checked against the viewer's role. */
  permission?: ProtectedField;
  group: "Candidate" | "Sourcing" | "Screening" | "Interview" | "Outcome" | "Timing";
  /** Shown by default. */
  visible?: boolean;
}

const dim = (field: DictField) => (store: RecruitmentStore, row: number) => {
  const idx = store.cols[field][row];
  return idx < 0 ? null : store.dicts[field][idx];
};

const date = (field: DateField) => (store: RecruitmentStore, row: number) => {
  const d = store.cols[field][row];
  return d < 0 ? null : d;
};

const num = (field: NumField, scale = 1) => (store: RecruitmentStore, row: number) => {
  const v = store.cols[field][row];
  return v === NULL_NUM ? null : v * scale;
};

// Named rather than anonymous arrows: these are cell renderers, not
// components, and a bare arrow returning JSX trips React's component lint.
function dateCell(field: DateField) {
  return function renderDate(store: RecruitmentStore, row: number): React.ReactNode {
    const d = store.cols[field][row];
    return d < 0 ? <span className="text-ink-4">—</span> : fmtDay(d);
  };
}

function textCell(field: DictField) {
  return function renderText(store: RecruitmentStore, row: number): React.ReactNode {
    const idx = store.cols[field][row];
    return idx < 0 ? (
      <span className="text-ink-4">—</span>
    ) : (
      <span className="truncate">{store.dicts[field][idx]}</span>
    );
  };
}

export const CANDIDATE_COLUMNS: CandidateColumn[] = [
  /* ---- Candidate ---------------------------------------------------- */
  {
    id: "name",
    header: "Candidate",
    group: "Candidate",
    width: 190,
    visible: true,
    value: (s, r) => s.names[r],
    render: (s, r) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-semibold text-ink">{s.names[r]}</span>
        {s.cols.is_repeat[r] === 1 ? (
          <Badge tone="outline" size="sm" title="Has applied before">
            re
          </Badge>
        ) : null}
      </span>
    ),
  },
  {
    id: "phone",
    header: "Phone",
    group: "Candidate",
    width: 118,
    visible: true,
    permission: "phone",
    value: (s, r) => s.phones[r] || null,
    render: (s, r) =>
      s.phones[r] ? (
        <span className="tabular-nums">{s.phones[r]}</span>
      ) : (
        <span className="text-ink-4">—</span>
      ),
  },
  {
    id: "experience",
    header: "Experience",
    group: "Candidate",
    width: 92,
    align: "right",
    visible: true,
    value: num("experience_years", 0.1),
    render: (s, r) => {
      const v = s.cols.experience_years[r];
      return v === NULL_NUM ? (
        <span className="text-ink-4">—</span>
      ) : (
        <span className="tabular-nums">{(v * 0.1).toFixed(1)} yrs</span>
      );
    },
  },
  { id: "degree", header: "Education", group: "Candidate", width: 108, visible: true, value: dim("degree"), render: textCell("degree") },
  { id: "institute", header: "Institute", group: "Candidate", width: 170, value: dim("institute"), render: textCell("institute") },
  { id: "industry", header: "Prior industry", group: "Candidate", width: 140, visible: true, value: dim("industry"), render: textCell("industry") },
  {
    id: "salary",
    header: "Current salary",
    group: "Candidate",
    width: 116,
    align: "right",
    permission: "salary",
    value: num("current_salary", 500),
    render: (s, r) => {
      const v = s.cols.current_salary[r];
      return v === NULL_NUM ? (
        <span className="text-ink-4">—</span>
      ) : (
        <span className="tabular-nums">{fmtSalary(v * 500, true)}</span>
      );
    },
  },
  { id: "city", header: "City", group: "Candidate", width: 96, value: dim("city"), render: textCell("city") },

  /* ---- Sourcing ------------------------------------------------------ */
  { id: "source", header: "Source", group: "Sourcing", width: 124, visible: true, value: dim("source"), render: textCell("source") },
  { id: "channel", header: "Channel", group: "Sourcing", width: 108, value: dim("channel"), render: textCell("channel") },
  { id: "recruiter", header: "Recruiter", group: "Sourcing", width: 132, visible: true, value: dim("recruiter"), render: textCell("recruiter") },
  { id: "applied_role", header: "Role applied", group: "Sourcing", width: 150, visible: true, value: dim("applied_role"), render: textCell("applied_role") },
  { id: "drive", header: "Campaign", group: "Sourcing", width: 104, value: dim("drive"), render: textCell("drive") },
  {
    id: "applied_date",
    header: "Applied",
    group: "Sourcing",
    width: 108,
    visible: true,
    value: date("applied_date"),
    render: dateCell("applied_date"),
  },

  /* ---- Screening ----------------------------------------------------- */
  { id: "screen_status", header: "Screening", group: "Screening", width: 108, value: dim("screen_status"), render: textCell("screen_status") },
  { id: "call_date", header: "Call date", group: "Screening", width: 108, value: date("call_date"), render: dateCell("call_date") },
  { id: "call_status", header: "Call outcome", group: "Screening", width: 116, value: dim("call_status"), render: textCell("call_status") },
  { id: "sp_date", header: "Pitch date", group: "Screening", width: 108, value: date("sp_date"), render: dateCell("sp_date") },
  {
    id: "sp_status",
    header: "Pitch result",
    group: "Screening",
    width: 106,
    visible: true,
    value: dim("sp_status"),
    render: (s, r) => {
      const idx = s.cols.sp_status[r];
      if (idx < 0) return <span className="text-ink-4">—</span>;
      const v = s.dicts.sp_status[idx];
      return (
        <Badge tone={v === "SP+" ? "good" : v === "SP-" ? "neutral" : "warn"}>{v}</Badge>
      );
    },
  },

  /* ---- Interview ----------------------------------------------------- */
  { id: "hiring_manager", header: "Hiring manager", group: "Interview", width: 150, value: dim("hiring_manager"), render: textCell("hiring_manager") },
  { id: "manager_date", header: "Manager interview", group: "Interview", width: 124, value: date("manager_date"), render: dateCell("manager_date") },
  { id: "manager_status", header: "Manager result", group: "Interview", width: 118, value: dim("manager_status"), render: textCell("manager_status") },
  { id: "final_date", header: "Final interview", group: "Interview", width: 118, value: date("final_date"), render: dateCell("final_date") },
  { id: "final_status", header: "Final result", group: "Interview", width: 112, value: dim("final_status"), render: textCell("final_status") },
  { id: "director", header: "Director panel", group: "Interview", width: 148, value: dim("director"), render: textCell("director") },

  /* ---- Outcome ------------------------------------------------------- */
  {
    id: "stage",
    header: "Furthest stage",
    group: "Outcome",
    width: 144,
    visible: true,
    value: (s, r) => s.cols.stage_reached[r],
    render: (s, r) => {
      const idx = s.cols.stage_reached[r];
      return (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: ordinalColor(idx, STAGES.length) }}
          />
          <span className="truncate">{STAGES[idx]?.label ?? "—"}</span>
        </span>
      );
    },
  },
  {
    id: "outcome",
    header: "Outcome",
    group: "Outcome",
    width: 122,
    visible: true,
    value: (s, r) => s.meta.outcomes[s.cols.outcome[r]],
    render: (s, r) => {
      const label = s.meta.outcomes[s.cols.outcome[r]] as Outcome;
      return (
        <span className="flex items-center gap-1.5">
          <StatusDot tone={OUTCOME_TONE[label] ?? "neutral"} />
          <span className="truncate">{label}</span>
        </span>
      );
    },
  },
  { id: "offer_date", header: "Offer date", group: "Outcome", width: 108, value: date("offer_date"), render: dateCell("offer_date") },
  { id: "offer_status", header: "Offer status", group: "Outcome", width: 110, value: dim("offer_status"), render: textCell("offer_status") },
  { id: "hired_role", header: "Role hired", group: "Outcome", width: 160, value: dim("hired_role"), render: textCell("hired_role") },
  { id: "team", header: "Business unit", group: "Outcome", width: 132, value: dim("team"), render: textCell("team") },
  { id: "actual_doj", header: "Start date", group: "Outcome", width: 108, visible: true, value: date("actual_doj"), render: dateCell("actual_doj") },
  { id: "loss_category", header: "Loss category", group: "Outcome", width: 128, value: dim("loss_category"), render: textCell("loss_category") },
  { id: "loss_reason", header: "Loss reason", group: "Outcome", width: 160, visible: true, value: dim("loss_reason"), render: textCell("loss_reason") },

  /* ---- Timing -------------------------------------------------------- */
  {
    id: "d_to_call",
    header: "To first call",
    group: "Timing",
    width: 104,
    align: "right",
    value: num("d_to_call"),
    render: (s, r) => dayCell(s.cols.d_to_call[r]),
  },
  {
    id: "time_to_offer",
    header: "To offer",
    group: "Timing",
    width: 96,
    align: "right",
    value: num("time_to_offer"),
    render: (s, r) => dayCell(s.cols.time_to_offer[r]),
  },
  {
    id: "time_to_hire",
    header: "To hire",
    group: "Timing",
    width: 96,
    align: "right",
    visible: true,
    value: num("time_to_hire"),
    render: (s, r) => dayCell(s.cols.time_to_hire[r]),
  },
  {
    id: "days_idle",
    header: "Days idle",
    group: "Timing",
    width: 98,
    align: "right",
    visible: true,
    value: num("days_idle"),
    render: (s, r) => {
      const v = s.cols.days_idle[r];
      if (v === NULL_NUM) return <span className="text-ink-4">—</span>;
      return (
        <span
          className={
            v > 45 ? "font-semibold tabular-nums text-serious-ink" : "tabular-nums"
          }
        >
          {fmtInt(v)}
        </span>
      );
    },
  },
  {
    id: "doj_slip",
    header: "Start slip",
    group: "Timing",
    width: 98,
    align: "right",
    value: num("doj_slip"),
    render: (s, r) => dayCell(s.cols.doj_slip[r]),
  },
];

function dayCell(v: number): React.ReactNode {
  if (v === NULL_NUM) return <span className="text-ink-4">—</span>;
  return <span className="tabular-nums">{fmtInt(v)}d</span>;
}

export const COLUMN_GROUPS = [
  "Candidate",
  "Sourcing",
  "Screening",
  "Interview",
  "Outcome",
  "Timing",
] as const;

/** Columns the viewer's role is permitted to see. */
export function permittedColumns(role: Role): CandidateColumn[] {
  return CANDIDATE_COLUMNS.filter(
    (c) => !c.permission || canSeeField(role, c.permission),
  );
}

export const DEFAULT_VISIBLE = CANDIDATE_COLUMNS.filter((c) => c.visible).map((c) => c.id);
