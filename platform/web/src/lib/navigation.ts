import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  CalendarClock,
  Gauge,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  Radar,
  ScrollText,
  ShieldCheck,
  Table2,
  TrendingDown,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import { can, type Capability, type Role } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line describing what question this page answers. */
  purpose: string;
  section: "Overview" | "Pipeline" | "People" | "Sourcing" | "Data" | "Administration";
  /** Capability that opens the page. Mirrors the page policy in permissions.ts. */
  capability: Capability;
  shortcut?: string;
}

export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Command Center",
    icon: LayoutDashboard,
    purpose: "The state of the whole operation in one screen.",
    section: "Overview",
    capability: "page.command-center",
    shortcut: "G then H",
  },
  {
    href: "/health",
    label: "Recruitment Health",
    icon: Radar,
    purpose: "Scorecards for every recruiter, stage and business unit.",
    section: "Overview",
    capability: "page.health",
    shortcut: "G then E",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: GitBranch,
    purpose: "Stage-by-stage conversion and where candidates are lost.",
    section: "Pipeline",
    capability: "page.pipeline",
    shortcut: "G then P",
  },
  {
    href: "/velocity",
    label: "Velocity & Aging",
    icon: CalendarClock,
    purpose: "How long each stage takes and what is sitting still.",
    section: "Pipeline",
    capability: "page.velocity",
    shortcut: "G then V",
  },
  {
    href: "/attrition",
    label: "Loss Analysis",
    icon: TrendingDown,
    purpose: "Every reason candidates leave the funnel, by stage.",
    section: "Pipeline",
    capability: "page.attrition",
    shortcut: "G then L",
  },
  {
    href: "/recruiters",
    label: "Recruiters",
    icon: UserCog,
    purpose: "Individual productivity, quality and conversion.",
    section: "People",
    capability: "page.recruiters",
    shortcut: "G then R",
  },
  {
    href: "/interviewers",
    label: "Interviewers",
    icon: Users,
    purpose: "Hiring-manager selectivity and interview load.",
    section: "People",
    capability: "page.interviewers",
  },
  {
    href: "/business-units",
    label: "Business Units",
    icon: Building2,
    purpose: "Hiring volume and outcomes by directorate.",
    section: "People",
    capability: "page.business-units",
  },
  {
    href: "/sources",
    label: "Sources",
    icon: Activity,
    purpose: "Which channels produce hires, not just applications.",
    section: "Sourcing",
    capability: "page.sources",
    shortcut: "G then S",
  },
  {
    href: "/talent",
    label: "Talent Insights",
    icon: GraduationCap,
    purpose: "Who applies, who converts, and what they cost.",
    section: "Sourcing",
    capability: "page.talent",
    shortcut: "G then T",
  },
  {
    href: "/roles",
    label: "Roles",
    icon: Gauge,
    purpose: "Requisition-level demand, difficulty and fill performance.",
    section: "Sourcing",
    capability: "page.roles",
  },
  {
    href: "/candidates",
    label: "Candidate Explorer",
    icon: Table2,
    purpose: "Every application record, filterable and exportable.",
    section: "Data",
    capability: "page.candidates",
    shortcut: "G then C",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: ScrollText,
    purpose: "Board-ready reports in PDF, Excel and CSV.",
    section: "Data",
    capability: "page.reports",
  },
  {
    href: "/admin/access",
    label: "Access Control",
    icon: ShieldCheck,
    purpose: "Who can see and do what, and the log of what they did.",
    section: "Administration",
    capability: "page.access-admin",
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: UsersRound,
    purpose: "Create and invite people, assign roles, and end sessions.",
    section: "Administration",
    capability: "page.access-admin",
  },
];

export const NAV_SECTIONS = [
  "Overview",
  "Pipeline",
  "People",
  "Sourcing",
  "Data",
  "Administration",
] as const;

/** Navigation entries the role is permitted to open. */
export function visibleNav(role: Role): NavItem[] {
  return NAV.filter((item) => can(role, item.capability));
}

export { ROLES, ROLE_RANK, type Role } from "@/lib/auth/permissions";
