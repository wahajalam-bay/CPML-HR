import {
  recordAudit,
  requirePrincipal,
  toErrorResponse,
} from "@/server/rbac";
import { buildScopedStore } from "@/server/store/scoped-store";

/**
 * The dataset, scoped to the caller.
 *
 * A separate route from `/api/v1/[...route]` because it returns gzipped bytes
 * rather than JSON, and mixing the two would mean the catch-all handler had to
 * branch on content type for one case.
 *
 * This is what `DATASET_MODE=server-scoped` points the browser at instead of the
 * static `/data/store.gz`. The difference is the whole security claim: the
 * static file contains every record, so client-side scoping there governs what
 * is *shown*; this contains only what the session may see, so scoping is also a
 * boundary.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const principal = await requirePrincipal();
    const { body, rowCount, withheldRows, withheldFields } =
      await buildScopedStore(principal);

    // The dataset is the personal data. Recording who pulled it, and how much of
    // it, is the point of having an audit log at all.
    await recordAudit(principal, "read.dataset", "store", {
      rowCount,
      scope: {
        scope: principal.scope,
        withheldRows,
        withheldFields,
      },
    });

    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-encoding": "gzip",
        // Per-session content. A shared cache holding one role's payload and
        // serving it to another is the exact failure this route prevents.
        "cache-control": "private, no-store",
        vary: "cookie",
        "x-row-count": String(rowCount),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
