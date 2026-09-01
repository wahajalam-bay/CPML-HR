# Deploying to Vercel

The platform ships in two postures, and you can move between them without
changing code.

| | Demo | Production |
|---|---|---|
| Dataset | Static 552 KB payload in `/public` | Per-role, from Postgres |
| Authentication | None — role switcher in the UI | Email + password, sessions in Postgres |
| RBAC | Governs what is *shown* | Governs what is *delivered* |
| Set-up | Deploy and open it | ~15 minutes |

Deploy the demo first to see it running, then add Postgres. Nothing is thrown
away in between.

---

## 0 · Run the production posture locally (5 minutes)

Nothing to install. `embedded-postgres` ships the real PostgreSQL binaries as an
npm package and runs them as a child process under your own user — no service,
no Docker, no administrator rights.

```bash
cd platform/web
npm install

npm run db:dev            # Postgres on 127.0.0.1:5433, cluster in .pgdata/
```

In a second terminal:

```bash
cd platform/web
cp .env.example .env.local     # already points at 127.0.0.1:5433
npm run db:migrate             # 14 tables
npm run db:seed                # 28,366 applications (needs etl/normalize.py output)
npm run accounts -- --demo-set # three accounts, one per access tier
npm run build && npm start
```

`npm run accounts -- --demo-set` prints what it created:

| Account | Role | Sees |
|---|---|---|
| `recruiter@bayut.sa` / `recruiter-limited-2026` | Recruiter | One book — 4,999 of 28,366 records |
| `manager@bayut.sa` / `manager-medium-2026` | Recruitment Manager | Every record, plus exports and salary |
| `admin@bayut.sa` / `admin-full-access-2026` | Admin | The above, plus access administration and user creation |

**These passwords are in a script in this repository, which makes them public.**
Change them or delete the accounts before anyone real uses this.

Then verify:

```bash
npm run test:accounts       # 78 checks: signs in as each account for real
npm run test:create-user    # 12 checks — the admin's Create account dialog
```

`npm run db:dev -- --fresh` starts over. Delete `.pgdata/` for the same effect.

**Why a real Postgres and not PGlite.** PGlite compiles Postgres to WASM and
needs no binaries at all, which is tempting — but its socket server holds one
connection for its lifetime, and a web app that opens and closes a connection
per request gets `ECONNRESET` on the second one. The binaries behave like the
thing you deploy against, which is the point of testing locally.

---

## 1 · Demo deploy (2 minutes)

```bash
cd platform/web
npx vercel        # link the project
npx vercel --prod
```

No environment variables required. With no `DATABASE_URL` the app skips
authentication entirely and serves the static dataset — the Access Control page
says so plainly rather than implying protection it does not have.

**Do not leave a demo deploy public.** It contains 28,366 real candidate
records. Put it behind Vercel's Deployment Protection (Project → Settings →
Deployment Protection → Vercel Authentication) until step 2 is done.

---

## 2 · Add Postgres

Any Postgres works. The driver is chosen from the connection string, not
configured: a `*.neon.tech` host uses Neon's HTTP driver, anything else uses
postgres.js over TCP. `DATABASE_DRIVER=neon|postgres` overrides the detection.

Neon is the easiest fit for serverless — its HTTP driver avoids the
connection-pool exhaustion a per-request TCP pool would cause.

**Vercel Marketplace → Neon → Create.** It sets `DATABASE_URL` for you.

Then create the schema:

```bash
cd platform/web
echo 'DATABASE_URL="postgresql://…"' > .env.local

npm run db:migrate      # creates 14 tables from drizzle/0000_*.sql
```

Load the dataset and create the first administrator in one command:

```bash
# The ETL output must exist first
python ../etl/normalize.py

npm run db:seed -- --reset \
  --admin you@bayut.sa \
  --password 'a-long-passphrase-you-will-remember' \
  --name 'Your Name'
```

That writes 28,366 applications, ~22,000 candidates and every dimension, then
creates an active `Admin` account. The bootstrap account skips email
verification deliberately — there is nobody else to approve it, and whoever ran
the command already controls the database.

---

## 3 · Turn on the real thing

Set these in **Project → Settings → Environment Variables**:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | *(set by Neon)* | Enables auth and the API |
| `NEXT_PUBLIC_DATASET_MODE` | `server-scoped` | Data is scoped before it leaves the server |
| `SIGNUP_ALLOWED_DOMAINS` | *(empty)* | Invitation-only — see below |
| `CRON_SECRET` | `openssl rand -base64 32` | Signs the maintenance cron |
| `RESEND_API_KEY` | *(from resend.com)* | Verification and reset emails |
| `MAIL_FROM` | `CPML HR <noreply@yourdomain.com>` | Must be a verified sender |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain` | Absolute links in emails |

Redeploy. The sign-in page is now the front door, and Deployment Protection can
come off.

**On `SIGNUP_ALLOWED_DOMAINS`:** leave it empty in production. With a value,
anyone at that domain can self-register; empty makes the platform
invitation-only, which is the correct posture for a dashboard of candidate
personal data. Add people from **Administration → Users**, two ways:

- **Invite** — they receive a link and set their own password. The default,
  because it proves they control the mailbox and nobody else ever knows their
  password.
- **Create account** — you set the password and the account works immediately.
  For when there is no mailbox to send to, for a shared function account, or for
  a demonstration. It sits behind its own capability (`action.create-user`, Admin
  and above) rather than under `page.access-admin`, because minting working
  credentials is a materially different power from sending an invitation. The
  audit entry records that this route was taken.

  Tick *"Also send them a link to set their own password"* unless you cannot —
  it stops the password you typed being a shared secret.

Neither route lets an administrator grant a role above their own, act on an
account that outranks them, or demote themselves. The role dropdown still lists
every role: hiding the option is a courtesy, refusing the call is the control, and
the refusal is what `npm run test:create-user` asserts.

A **Recruiter** account needs the recruiter name from the source sheet, chosen
from a dropdown of real names rather than typed. A Recruiter with no book mapped
sees nothing at all, and a typo would produce exactly that with no error to
explain it.

**Without `RESEND_API_KEY`**, emails are printed to the server log instead of
sent. Sign-up still completes — read the link out of the Vercel function logs.
That is a deliberate fallback for preview environments, not a production
configuration.

---

## 4 · Verify

```bash
npm run verify              # typecheck + lint + build
npm run start

npm test                    # accounts + create-user + security

npm run test:accounts       # 78 checks — signs in as each account for real
npm run test:create-user    # 12 checks — the admin's Create account dialog
npm run test:security       # 130 checks — the invariants an attacker would probe
npm run test:flows          # 26 checks — invitation and password reset, end to end
npm run test:rbac           # 47 checks — DEMO posture only, see below

npm run shoot -- / /pipeline /candidates \
  --email admin@bayut.sa --password '…'
```

**`test:flows`** reads the invitation and reset links out of the server log,
because without `RESEND_API_KEY` that is where they go. Start the server with its
output redirected and point the suite at the file:

```bash
npm start > server.log 2>&1 &
npm run test:flows -- --log server.log
```

**`test:security`** provisions and removes its own accounts, all prefixed `sec-`.
It uses raw HTTP rather than a browser for everything except the sign-in form:
`fetch` follows redirects, and a redirect to the sign-in page that resolves to
200 is one of the bugs the suite exists to catch, so redirects have to stay
visible.

**`test:rbac` only applies to a demo instance.** It seeds a role into local
storage the way the in-app switcher does, which is meaningless once a database
is configured — the role then comes from the session cookie and local storage is
correctly ignored. Pointed at a server-scoped instance it detects this and tells
you to run `test:accounts` instead, rather than reporting 47 failures for the
right reason.

`shoot` takes `--email`/`--password` against a server-scoped instance and
`--role`/`--book` against a demo one, for the same reason.

Then, against the deployed URL:

```bash
# The API must refuse anonymous callers
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/api/v1/meta      # 401

# The cron endpoint must refuse unsigned calls
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/api/cron/maintenance  # 401

# Security headers must be present
curl -sI https://your-domain/ | grep -iE 'content-security|strict-transport|x-frame'
```

---

## What runs where

```
Browser ── middleware (edge) ── route handlers (node) ── Neon Postgres
             │                       │
             │                       ├── auth: argon2id, opaque sessions
             │                       ├── RBAC: row scope + field redaction
             │                       └── analytics: one metric definition
             │
             ├── nonce CSP per request
             ├── CSRF origin check on mutations
             └── session gate on protected paths
```

Pages render per request rather than at build time. A build-time nonce is a
contradiction, and authenticated views of personal data should not sit in a
shared cache regardless. The JS chunks and the static dataset stay cacheable, so
the cost is a few kilobytes of markup.

**Region.** `vercel.json` pins functions to `fra1`. Move it next to your
database — a function in Washington querying a database in Frankfurt pays the
round trip on every query, and the analytics endpoints make several.

**Cron.** `/api/cron/maintenance` runs nightly to clear expired sessions and
rate-limit windows. Rows nothing will read again otherwise grow without bound
and slow the indexes authentication depends on.

---

## Security posture

| Control | Implementation |
|---|---|
| Passwords | Argon2id, 19 MiB / t=2 (OWASP baseline) |
| Sessions | 256-bit opaque tokens, SHA-256 at rest, httpOnly + SameSite=Lax |
| Revocation | Immediate — sessions are rows, not self-contained tokens |
| Rate limiting | Per-account **and** per-IP, in Postgres (serverless has no shared memory) |
| Lockout | 10 failed attempts → 15 minutes |
| Account creation | Invitation by default; direct creation behind its own capability, audited |
| Enumeration | Identical responses and timings whether or not an account exists |
| CSP | Per-request nonce, `strict-dynamic`, no `unsafe-inline` on scripts |
| CSRF | SameSite=Lax + origin/host check on every mutation |
| Transport | HSTS 2 years, `includeSubDomains; preload` |
| Personal data | `private, no-store`; never in a shared cache |
| Audit | Every sign-in, denial, record read and export |

### The one thing to understand

In `client-full` mode the whole dataset ships to the browser. Client-side RBAC
governs what is **shown**, not what was **delivered** — someone can change their
role in local storage and see rows the UI was hiding.

`server-scoped` closes this. `/api/v1/store` filters rows to the session's scope
and blanks the fields the role may not see *before* serialising, so the browser
is never handed data the session is not entitled to. Measured, not asserted:

```
recruiter@bayut.sa   4,999 of 28,366 rows · 1 recruiter  · salary withheld
manager@bayut.sa    28,366 of 28,366 rows · 17 recruiters · every field
```

A withheld column is sent as its null marker, not as zero — zero is a valid
salary, and a redaction that looks like data corrupts every average computed from
it. The static `/data/store.gz` is deliberately **not** a fallback for that
endpoint: if it fails, the honest outcome is an error, because quietly serving
the full dataset instead would turn an outage into a disclosure.

Authorisation is also checked twice on every page, deliberately. The
authenticated layout refuses on a full page load, so a page the role may not open
is never rendered or sent; `RouteGuard` refuses on client-side navigation, which
does not re-run a layout. Neither is redundant — the first cannot see a soft
navigation, the second cannot stop markup from being sent.

Three things that were not true until they were tested, and are worth knowing
about because the same mistakes are easy to reintroduce:

**The static dataset was public.** Next serves anything under `/public` without
consulting a route handler, so `/data/store.gz` — the whole 28,366 records —
answered any request with no session at all. Row scoping, field redaction, the
audit log and the sign-in page were all bypassed by one URL. Middleware now gates
`/data/` on the same flag as everything else; the matcher used to exclude it, on
the reasoning that a static payload gains nothing from a per-request nonce. True,
and beside the point.

**A revoked session was an unrecoverable lockout.** Middleware bounced
cookie-bearing requests away from `/signin`; the layout bounced session-less
requests towards it. A stale cookie — after a password reset elsewhere, an
administrator revoking sessions, or an expiry — put the two in a loop and the
browser gave up with `ERR_TOO_MANY_REDIRECTS`. The user could not reach the form
to fix it without clearing cookies by hand. Middleware no longer makes that
call: it cannot tell a valid session from a stale cookie, and the auth pages,
which have database access, already redirect a genuinely signed-in visitor.

**A scoped payload carried the org chart.** Row scoping removed the rows, but the
dictionaries are shared across the dataset, so a Recruiter with 4,999 of their own
records still received the names of all 17 recruiters, 123 hiring managers, 83
interviewers and 4 directors — none of whom appeared in any row they were given.
The people dictionaries are compacted to what the delivered rows reference; the
taxonomies are left whole on purpose, so chart legends and colour assignments mean
the same thing for every role.

The app states which posture is in force on `/admin/access` rather than
implying a guarantee it cannot make. **Set `server-scoped` before this holds
real data.**

---

## The Python backend

`platform/api/` is a complete FastAPI + Celery + Redis implementation of the
same model. It does not deploy to Vercel — Celery needs a long-lived worker and
Redis needs a persistent connection, neither of which fits serverless functions.

Deploy it to Railway, Fly or Render if you want a separate Python service, or a
scheduled Sheets sync that outlives a 60-second function timeout. The Next.js
backend above is the one that runs on Vercel, and the two implement the same
metric definitions deliberately.

---

## Troubleshooting

**Blank page, CSP errors in the console.** The nonce is not reaching the script
tags. Confirm `middleware.ts` is deployed and `export const dynamic =
"force-dynamic"` is still in `src/app/layout.tsx`.

**`DATABASE_URL is not set`.** Set for the wrong environment. Vercel scopes
variables to Production / Preview / Development separately.

**Sign-up says "by invitation".** Working as intended — `SIGNUP_ALLOWED_DOMAINS`
is empty. Invite from Administration → Users, or set the variable.

**Verification email never arrives.** Without `RESEND_API_KEY` it is in the
function logs. With one, check the sender domain is verified at Resend.

**A Recruiter sees no records.** Their account has no book mapped. Set the
recruiter name in Administration → Users to match the source sheet exactly.
Fail-closed is deliberate: an unmapped scope shows nothing rather than
everything.
