"""Server-side report rendering.

The browser generates reports directly for anything a user is looking at — it
already holds the data and the round trip would be pure latency. This path
exists for the cases the browser cannot serve: scheduled reports with no one
signed in, and exports large enough that rendering them client-side would
freeze the tab.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.repositories.analytics import AnalyticsRepository, FilterSpec

log = logging.getLogger(__name__)

ARTIFACT_ROOT = Path("var/reports")


@dataclass(slots=True)
class ReportArtifact:
    uri: str
    content_type: str
    generated_at: dt.datetime
    row_count: int


class ReportBuilder:
    """Builds a report artifact and returns a URI the client can fetch."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.repo = AnalyticsRepository(session)

    def build(self, report_id: str, scope_key: str) -> ReportArtifact:
        builder = getattr(self, f"_build_{report_id}", None)
        if builder is None:
            raise ValueError(
                f"Unknown report '{report_id}'. Expected one of: "
                "executive, recruiter, pipeline, source, loss, talent."
            )

        # A scope key round-trips the exact filters the request was made under;
        # decoding it here keeps the worker stateless.
        spec = _spec_from_key(scope_key)
        headers, rows = builder(spec)
        return self._write_csv(report_id, headers, rows)

    # -- Individual reports ------------------------------------------------

    def _build_executive(self, spec: FilterSpec):
        summary = self.repo.summary(spec)
        return ["Measure", "Value"], [[k, v] for k, v in summary.items()]

    def _build_recruiter(self, spec: FilterSpec):
        rows = self.repo.by_dimension(spec, "recruiter", min_applications=1, limit=500)
        return _tabulate(rows)

    def _build_pipeline(self, spec: FilterSpec):
        rows = self.repo.funnel(spec)
        return _tabulate(rows)

    def _build_source(self, spec: FilterSpec):
        rows = self.repo.by_dimension(spec, "source", min_applications=1, limit=500)
        return _tabulate(rows)

    def _build_loss(self, spec: FilterSpec):
        rows = self.repo.loss_breakdown(spec)
        return _tabulate(rows)

    def _build_talent(self, spec: FilterSpec):
        rows = self.repo.by_dimension(spec, "industry", min_applications=10, limit=500)
        return _tabulate(rows)

    # -- Output ------------------------------------------------------------

    def _write_csv(self, report_id: str, headers: list[str], rows: list[list]) -> ReportArtifact:
        ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%d-%H%M%S")
        path = ARTIFACT_ROOT / f"cpml-{report_id}-{stamp}.csv"

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(rows)
        # BOM so Excel on Windows reads the UTF-8 correctly.
        path.write_text("﻿" + buffer.getvalue(), encoding="utf-8")

        return ReportArtifact(
            uri=str(path),
            content_type="text/csv; charset=utf-8",
            generated_at=dt.datetime.now(dt.UTC),
            row_count=len(rows),
        )


def _tabulate(rows: list[dict]) -> tuple[list[str], list[list]]:
    if not rows:
        return ["No data"], []
    headers = list(rows[0].keys())
    return headers, [[row.get(h) for h in headers] for row in rows]


def _spec_from_key(scope_key: str) -> FilterSpec:
    """Rebuild a FilterSpec from its cache key.

    The key is positional and produced by `FilterSpec.cache_key`; the two must
    change together.
    """
    parts = scope_key.split("|")
    if len(parts) < 16:
        return FilterSpec()

    def date_at(index: int) -> dt.date | None:
        value = parts[index]
        return dt.date.fromisoformat(value) if value and value != "None" else None

    def list_at(index: int) -> list[str]:
        return [v for v in parts[index].split(",") if v]

    return FilterSpec(
        date_from=date_at(0),
        date_to=date_at(1),
        recruiters=list_at(2),
        sources=list_at(3),
        roles=list_at(4),
        business_units=list_at(5),
        hiring_managers=list_at(6),
        degrees=list_at(7),
        industries=list_at(8),
    )
