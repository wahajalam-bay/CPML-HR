import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  ValidationError,
  recordAudit,
  requirePrincipal,
  toErrorResponse,
} from "@/server/rbac";
import { RULES, consume } from "@/server/auth/rate-limit";
import {
  GROUPABLE,
  byDimension,
  funnel,
  listApplications,
  lossBreakdown,
  meta,
  summary,
  timeseries,
  type AnalyticsFilter,
  type Granularity,
  type Groupable,
} from "@/server/queries/analytics";

/**
 * The analytics API.
 *
 * A single catch-all handler rather than a file per endpoint: every route needs
 * the identical preamble — authenticate, rate limit, parse filters — and
 * duplicating that across ten files is how one of them ends up missing a step.
 * Dispatch is an explicit switch over a closed set of paths, so an unknown
 * route 404s rather than falling through to something.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------
 * Filter parsing
 * ---------------------------------------------------------------------- */

const STAGES = [
  "applied", "screened", "phone_screen", "assessment", "sales_pitch",
  "manager_interview", "final_interview", "offer", "joined",
] as const;

const OUTCOMES = [
  "In Process", "Hired", "Rejected", "Withdrawn", "Dropped Off", "Lapsed",
] as const;

/**
 * A date that exists.
 *
 * The shape check alone accepts 9999-99-99 and 2026-13-45, which then reach
 * Postgres as a date literal and fail there — a 500 for what is plainly a bad
 * request. The round-trip comparison rejects both the impossible month and the
 * 31st of February, which a range check would not.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That date does not exist.");

const filterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  recruiter: z.array(z.string().max(120)).max(50).optional(),
  source: z.array(z.string().max(80)).max(50).optional(),
  role: z.array(z.string().max(120)).max(50).optional(),
  businessUnit: z.array(z.string().max(120)).max(50).optional(),
  hiringManager: z.array(z.string().max(120)).max(50).optional(),
  degree: z.array(z.string().max(40)).max(20).optional(),
  industry: z.array(z.string().max(80)).max(80).optional(),
  outcome: z.array(z.enum(OUTCOMES)).max(6).optional(),
  stageAtLeast: z.enum(STAGES).optional(),
  stageExactly: z.enum(STAGES).optional(),
  // Bounded so a pathological pattern cannot become a slow LIKE scan.
  search: z.string().max(80).optional(),
});

/**
 * An integer query parameter, or the default.
 *
 * `Number("abc")` is NaN, and NaN survives Math.min/Math.max unchanged — so a
 * non-numeric limit reached the query builder as NaN rather than as a number.
 * The clamping that was supposed to bound it did nothing.
 */
function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function parseFilter(params: URLSearchParams): AnalyticsFilter {
  const multi = (key: string) => {
    const values = params.getAll(key).flatMap((v) => v.split("~")).filter(Boolean);
    return values.length ? values : undefined;
  };

  const parsed = filterSchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    recruiter: multi("recruiter"),
    source: multi("source"),
    role: multi("role"),
    businessUnit: multi("businessUnit"),
    hiringManager: multi("hiringManager"),
    degree: multi("degree"),
    industry: multi("industry"),
    outcome: multi("outcome"),
    stageAtLeast: params.get("stageAtLeast") ?? undefined,
    stageExactly: params.get("stageExactly") ?? undefined,
    search: params.get("search") ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Name the parameter. "Invalid filter" sends the caller looking through
    // fifteen of them; "outcome: expected one of…" does not.
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new ValidationError(
      `Invalid filter — ${where}${issue?.message ?? "malformed parameters"}`,
    );
  }

  const f = parsed.data;
  return {
    from: f.from,
    to: f.to,
    recruiters: f.recruiter,
    sources: f.source,
    roles: f.role,
    businessUnits: f.businessUnit,
    hiringManagers: f.hiringManager,
    degrees: f.degree,
    industries: f.industry,
    outcomes: f.outcome,
    stageAtLeast: f.stageAtLeast,
    stageExactly: f.stageExactly,
    search: f.search,
  };
}

/* -------------------------------------------------------------------------
 * Handler
 * ---------------------------------------------------------------------- */

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ route: string[] }> },
) {
  try {
    const { route } = await context.params;
    const path = route.join("/");
    const params = request.nextUrl.searchParams;

    const principal = await requirePrincipal();

    // Keyed on the user, not the IP: a shared office NAT would otherwise let
    // one heavy user throttle everyone behind it.
    const limited = await consume(`api:${principal.user.id}`, RULES.api);
    if (!limited.allowed) {
      return Response.json(
        { error: "Too many requests. Slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(limited.retryAfter) },
        },
      );
    }

    const filter = parseFilter(params);
    // Personal data: never cached by a proxy, and the response varies per role.
    const headers = { "Cache-Control": "private, no-store" };

    switch (path) {
      case "meta":
        return Response.json(await meta(principal), { headers });

      case "analytics/summary":
        return Response.json(await summary(filter, principal), { headers });

      case "analytics/funnel":
        return Response.json(await funnel(filter, principal), { headers });

      case "analytics/timeseries": {
        const granularity = (params.get("granularity") ?? "month") as Granularity;
        if (!["day", "week", "month", "quarter"].includes(granularity)) {
          return Response.json(
            { error: "granularity must be one of: day, week, month, quarter." },
            { status: 422 },
          );
        }
        return Response.json(
          await timeseries(filter, principal, granularity),
          { headers },
        );
      }

      case "analytics/losses":
        return Response.json(
          await lossBreakdown(filter, principal, params.get("includeInferred") === "true"),
          { headers },
        );

      case "applications": {
        const result = await listApplications(filter, principal, {
          offset: intParam(params, "offset", 0),
          limit: intParam(params, "limit", 100),
        });
        // Reads of candidate-level personal data are recorded.
        await recordAudit(principal, "read.applications", "applications", {
          scope: filter,
          rowCount: result.items.length,
        });
        return Response.json(result, { headers });
      }

      default: {
        // Grouped metrics: /api/v1/analytics/by/<dimension>
        const grouped = path.match(/^analytics\/by\/(.+)$/);
        if (grouped) {
          const dimension = grouped[1] as Groupable;
          if (!(dimension in GROUPABLE)) {
            return Response.json(
              {
                error: `Unknown dimension "${dimension}". Expected one of: ${Object.keys(GROUPABLE).join(", ")}.`,
              },
              { status: 422 },
            );
          }
          return Response.json(
            await byDimension(dimension, filter, principal, {
              minApplications: intParam(params, "minApplications", 1),
              limit: intParam(params, "limit", 200),
            }),
            { headers },
          );
        }

        return Response.json(
          { error: `No such endpoint: /api/v1/${path}` },
          { status: 404 },
        );
      }
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
