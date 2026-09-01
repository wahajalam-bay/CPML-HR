# CPML HR

A recruitment analytics and operations platform for CPML, built on the **IS
Performance Dashboard Design System v2** (Bayut Saudi Arabia · PropForce KSA).

It runs on the real operational dataset: **28,366 application records** spanning
1 Jan 2025 → 19 May 2026, extracted from `CPML Recruitment Sheet 2025-2026
Updated.xlsx` and normalised into an analytics-ready model.

This is not an ATS. It does not manage candidates — it explains the recruitment
operation.

---

## What the data actually says

The funnel these 28,366 records describe:

| Stage | Entered | Cleared | Carried to next |
|---|---:|---:|---:|
| Applied | 28,366 | 28,366 | 99.5% |
| Screened | 28,217 | 22,724 | 96.5% |
| Phone Screen | 27,243 | 9,880 | **26.4%** ← biggest leak |
| Assessment | 7,197 | 7,055 | 99.8% |
| Sales Pitch | 7,186 | 3,796 | 46.8% |
| Manager Interview | 3,362 | 1,468 | 42.1% |
| Final Interview | 1,416 | 1,355 | 96.3% |
| Offer | 1,364 | 1,303 | 93.2% |
| Joined | 1,271 | — | — |

Four findings the platform surfaces on load:

1. **The phone screen is the real gate.** 27,243 candidates are contacted;
   9,880 qualify. Everything downstream is comparatively efficient.
2. **11,580 applications went cold** with no recorded outcome — 41% of intake.
   Sourced, screened, often called, then simply abandoned.
3. **61 candidates accepted an offer and never started.** The most expensive
   failure in the funnel: full cost incurred, headcount gap left open.
4. **Referral converts 4.5× better than LinkedIn** (17.2% vs 3.8%), while
   LinkedIn supplies 81% of all volume.

---

## Layout

```
platform/
├── etl/normalize.py        Excel → canonical dataset (offline reference impl.)
├── data/canonical.jsonl    One clean record per application
├── web/                    Next.js 15 · React 19 · TypeScript · Tailwind v4
│   ├── public/data/        store.gz — 552 KB columnar payload
│   ├── src/middleware.ts   Per-request nonce CSP
│   ├── src/lib/auth/       The permission model — one source of truth
│   ├── src/lib/data/       Columnar store, query engine, metric catalogue
│   ├── src/components/     Design system, charts, tables, filters, guards
│   ├── src/features/       One folder per analytics surface
│   └── scripts/            shoot.mjs (visual + console) · rbac-test.mjs (access)
└── api/                    FastAPI · SQLAlchemy · Postgres · Redis · Celery
    ├── app/models/         Analytics-shaped warehouse schema
    ├── app/repositories/   Metric SQL — mirrors the browser definitions
    ├── app/services/       Sheets ingestion, cache, audit, reporting
    ├── app/workers/        Celery sync, view refresh, exports
    └── migrations/         Materialised views and supporting indexes
```

---

## Running it

```bash
# 1. Regenerate the dataset from the source workbook (optional — output is committed)
python etl/normalize.py

# 2. Frontend
cd web
npm install
npm run dev            # http://localhost:3000

# 3. Verify
npm run verify                 # typecheck + lint + production build
npm run start                  # then, against the running server:
npm run test:rbac              # 44 access-control assertions across 4 roles
npm run shoot -- / /pipeline /velocity /attrition /health /talent \
                 /candidates /reports /sources /recruiters
npm run shoot -- /admin/access --role Admin      # capture a guarded page
npm run shoot -- / --dark                        # dark mode
```

The API is a separate deployment and needs Postgres and Redis:

```bash
cd api
pip install -e ".[dev]"
psql $DATABASE_URL -f migrations/001_analytics_views.sql
uvicorn app.main:app --reload
celery -A app.workers.celery_app worker -B --loglevel=info
```

---

## Architecture

```
Google Sheets  →  Celery sync  →  PostgreSQL  →  FastAPI  →  Next.js
(source of truth)  (every 2h)     (+ mat. views)  (+ Redis)   (columnar store)
```

Google Sheets stays the operational source of truth — recruiters work in it all
day and nothing writes back to it. Postgres holds a read-optimised projection,
rebuilt on a schedule, with materialised views for the aggregates the dashboard
asks for on nearly every page.

### Why the browser holds the whole dataset

The entire dataset ships as a **552 KB gzipped columnar payload**. Every string
dimension is dictionary-encoded to an integer index; sparse columns (offer
dates, business units — the ~90% of columns that only apply deep in the funnel)
are delta-encoded rather than shipped dense.

A filter pass is then `mask[column[row]]` — a byte lookup, ~1 ms across all
28,366 rows. That is what makes cross-filtering feel instant: every chart on a
page re-derives itself on each keystroke, with no request in the loop.

The FastAPI layer exists for the cases this cannot serve: role-scoped access to
personal data, audit trails, scheduled reports, and datasets past the point
where shipping everything stops being reasonable. `web/src/lib/data/` is the
seam — swapping the local store for API calls changes that folder and nothing
above it.

### One definition per metric

`web/src/lib/data/metrics.ts` and `api/app/repositories/analytics.py` implement
the same metric catalogue. A "hire" means the same thing in a Postgres
aggregate as in a React chart — the only way a figure in a board report can be
trusted to match the screen it came from.

---

## Design system

Implements the IS Performance Dashboard Design System v2 as specified: Bayut
green (`#0d7a3f`) on `#f4f8f5`, Segoe UI, 16–18px radii, the tokenised shadow
scale and green glow, and glassmorphism **only** on the header, filter bar and
floating panels — never on content cards or tables, where it costs legibility.

Every colour is a CSS custom property, so light and dark cascade from one place
(`web/src/app/globals.css`).

### The chart palette was computed, not chosen

Brand hues were snapped to each mode's OKLCH lightness band, then slot order
was selected by enumerating orderings and maximising worst-case colour-vision
separation:

| | Adjacent CVD ΔE | Normal-vision ΔE | Contrast vs surface |
|---|---:|---:|---:|
| Categorical, light | 19.2 | 20.5 | all ≥ 3:1 |
| Categorical, dark | 11.9 | 18.9 | all ≥ 3:1 |
| Ordinal ramps | monotone L, ΔL ≥ 0.06 | — | light end ≥ 2:1 |

Targets are ΔE ≥ 8 (CVD) and ≥ 15 (normal vision), so there is real headroom.

The palette is capped at **six categorical slots** because the Bayut brand has
exactly six distinct hue families — a seventh would be a visual duplicate of
one already present. A seventh series folds into "Other"; the palette is never
cycled. Scatter and bubble forms, where any two marks can touch, default to a
single hue.

Status colours are a separate fixed five-band scale and always ship with an
icon **and** a label, so meaning survives red-green colour blindness. The blue
mid-band is what breaks the red→green collision.

---

## Judgement calls worth knowing about

**The Senior-Director panel is not a funnel stage.** Only 344 of 1,364 offers
went through it. Modelling it linearly would invent a 1,000-person drop-off
that never happened, so it is carried as an attribute instead.

**"Went cold" is separated from recorded loss reasons everywhere.** 11,580
applications end with no reason captured — nine times more than every genuine
reason combined. Mixing them would bury the reasons someone can act on, so the
inferred category is excluded from loss charts and reported as its own figure.

**"Offer → Join" is denominated on offers *placed*, not accepted.** Twenty
records carry a start date with no acceptance logged; an accepted-offer
denominator produced rates above 100% in small groups.

**Ranked bars print secondary measures as figures, not as a background track.**
A shared-scale track only reads when both measures share a magnitude — drawing
876 hires against 23,017 applications compresses every bar to a sliver.

**Charts state what they omit.** The Sankey folds loss arms under 1.5% of
intake and says so in its footnote. Coverage notes appear wherever a metric
rests on partial data — experience is disclosed on 35% of records, salary on
9%. Every chart carries a table view, which is also the relief channel for the
light-mode contrast band.

**"Last 30 days" is anchored to the dataset horizon**, not the wall clock.
Anchoring to today would silently return nothing.

---

## Deviations from the original brief

Three, all deliberate:

- **`xlsx` (SheetJS) was replaced with `write-excel-file`.** The npm build of
  SheetJS carries unpatched prototype-pollution and ReDoS advisories with no
  fix available.
- **`react-dnd` was replaced with `@dnd-kit`.** react-dnd's HTML5 backend has
  unresolved React 19 peer issues.
- **`@react-pdf/renderer` was replaced with `jsPDF` + autoTable.** The reports
  here are tabular, which is what autoTable is for; React PDF would add
  significant weight for layout control these reports do not need.

`npm audit` reports **0 vulnerabilities**.

---

## Access control

Five roles, each inheriting everything from the rank below it. The whole model
lives in `web/src/lib/auth/permissions.ts`; the API mirrors it in
`api/app/core/security.py`.

| | Recruiter | Rec. Manager | HR Director | Admin | Super Admin |
|---|:--:|:--:|:--:|:--:|:--:|
| Permissions held | 8/28 | 23/28 | 25/28 | 28/28 | 28/28 |
| Sees all recruiters' records | — | ● | ● | ● | ● |
| Compensation history | — | ● | ● | ● | ● |
| National identity number | — | — | ● | ● | ● |
| Exports | — | ● | ● | ● | ● |
| Access administration | — | — | — | ● | ● |

Enforcement runs at four levels, and each one is separately testable:

- **Page** — `RouteGuard` wraps the content area, so a route is protected by
  existing. Hiding a sidebar link is a courtesy; direct URLs are the actual
  threat. Unmapped routes fail closed.
- **Row** — scope is merged into the filter *before* the user's own filters and
  overwrites the recruiter dimension, so a scoped user cannot widen past their
  own book by picking someone else in the filter bar. Clearing every filter
  returns them to their book, not to the dataset.
- **Field** — `<ProtectedValue>` is the single call site for protected data.
  Restricted keys are **removed**, never nulled: an explicit null is
  indistinguishable from "the sheet had no value here", and that ambiguity
  would corrupt every coverage statistic downstream.
- **Action** — exports, view-saving and role switching are capabilities, checked
  in the handler as well as on the button.

Everything lands in an audit log — reads of candidate records, denied page
attempts, and every export with its row count and filter scope. `/admin/access`
renders the live matrix, the protected-field table and the log.

### The honest caveat

**Client-side rules govern what is shown, not what was delivered.** In
`client-full` mode the whole dataset ships to the browser, so a determined user
can change their role in local storage and see rows the UI was hiding. The app
states this on `/admin/access` rather than implying a guarantee it cannot make.

The API is the real boundary: it re-derives the role from a signed JWT, rewrites
a scoped caller's queries to their own book, and strips restricted fields before
serialising. Setting `NEXT_PUBLIC_DATASET_MODE=server-scoped` and pointing the
store at the authenticated endpoint makes the two agree — at which point the
browser is never handed data the session may not see.

## Security

| Control | Implementation |
|---|---|
| CSP | Per-request nonce via `middleware.ts`, `strict-dynamic`, no `unsafe-inline` on scripts |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Transport | HSTS, 2 years, `includeSubDomains; preload` |
| Referrer | `strict-origin-when-cross-origin` |
| Device APIs | `Permissions-Policy` denies camera, mic, geolocation, FLoC |
| Dataset caching | `private, no-store` — personal data never enters a shared cache |
| Exfiltration | `connect-src` is same-origin plus the API host only |
| Fingerprinting | `X-Powered-By` removed |

Pages render per request because a build-time nonce is a contradiction — and
per-request rendering is the right posture for authenticated views of personal
data anyway. The JS chunks and the dataset stay cacheable, so the cost is a few
kilobytes of markup.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | 16 routes + middleware |
| `npm run test:rbac` | **44/44** across 4 roles |
| `npm run shoot` | 14 routes, 0 console errors, light and dark |
| `ruff check app/` | clean |
| `npm audit` | 0 vulnerabilities |

Two harnesses, both of which fail loudly rather than silently:

`scripts/shoot.mjs` loads each route in a real browser and **fails on any
console error or unhandled rejection**. It caught React components crossing the
server/client boundary, a conditional `useId`, and — most usefully — a CSP I had
written myself that blocked Next's bootstrap and left every page a skeleton.
Every check in the suite was "passing" against that skeleton until this caught it.

`scripts/rbac-test.mjs` drives a real browser as each role and asserts what that
role can actually reach, see and do. Pass `--role` to `shoot.mjs` to capture any
guarded page as a role permitted to open it.

---

*Internal use only · Bayut Saudi Arabia · PropForce KSA*
