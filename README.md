# CPML HR

Recruitment analytics and operations for CPML — Bayut Saudi Arabia / PropForce KSA.

Not an ATS. It does not manage candidates; it explains the recruitment operation:
where the funnel leaks, which recruiters and channels actually convert, how long
each stage takes, and why candidates are lost.

```
platform/
  etl/          Python — reads the source workbook, emits the canonical dataset
  web/          Next.js 15 — the application, the API, and the analytics engine
  api/          FastAPI — the same model for a long-running Python service
  DEPLOYMENT.md How to run it locally and how to deploy it
```

**Start here → [`platform/DEPLOYMENT.md`](platform/DEPLOYMENT.md)**, section 0 runs
the production posture locally in about five minutes with nothing to install.

---

## The source data is not in this repository

Two files are deliberately excluded, and the platform runs without both:

| | Why |
|---|---|
| `CPML Recruitment Sheet …xlsx` | The widest surface — national identity numbers, email addresses, salary history, free-text remarks. None of it reaches the payload the application ships. |
| `platform/data/canonical.jsonl` | A build artefact. `python platform/etl/normalize.py` regenerates it from the workbook. |

Keep the workbook wherever your organisation keeps HR source files and run the
ETL locally.

**What *is* committed** is `platform/web/public/data/store.gz` — the columnar
analytics payload, 552 KB, carrying candidate names and phone numbers because the
application cannot render without them. Treat this repository accordingly: it holds
personal data and should stay private.

---

## Two postures

| | Demo | Production |
|---|---|---|
| Dataset | Static payload in `/public` | Per-role, from Postgres |
| Authentication | None | Email + password, sessions in Postgres |
| Access control | Governs what is **shown** | Governs what is **delivered** |

`NEXT_PUBLIC_DATASET_MODE=server-scoped` is the difference. In that posture the
browser is never handed a record or a field the session may not see — a Recruiter
receives 4,999 of 28,366 rows, with compensation absent from the payload rather
than blanked in the interface.

## Tests

```bash
cd platform/web
npm test                 # accounts, user creation, security invariants
npm run test:security    # 130 checks — what an attacker would try
npm run test:flows       # invitation and password reset, end to end
```
