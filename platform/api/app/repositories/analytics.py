"""Analytics repository.

Every metric the dashboard shows is defined exactly once, here, in SQL that
mirrors the browser-side definitions in `web/src/lib/data/metrics.ts`. A "hire"
means the same thing in a Postgres aggregate as it does in a React chart —
which is the only way a number in a board report can be trusted to match the
number on the screen it came from.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from app.models.recruitment import (
    STAGE_ORDER,
    Application,
    BusinessUnit,
    Candidate,
    Interviewer,
    Outcome,
    Recruiter,
    Role,
    Source,
    Stage,
)

Granularity = Literal["day", "week", "month", "quarter"]

# Dimension name -> (joined table, label column). Keeps the API's `group_by`
# parameter a closed set rather than something interpolated into SQL.
DIMENSIONS: dict[str, tuple[Any, Any]] = {
    "recruiter": (Recruiter, Recruiter.name),
    "source": (Source, Source.name),
    "channel": (Source, Source.channel),
    "role": (Role, Role.title),
    "business_unit": (BusinessUnit, BusinessUnit.name),
    "hiring_manager": (Interviewer, Interviewer.name),
    "degree": (Candidate, Candidate.degree),
    "institute": (Candidate, Candidate.institute),
    "industry": (Candidate, Candidate.industry),
    "city": (Candidate, Candidate.city),
}

_JOIN_FOR: dict[Any, tuple[Any, Any]] = {
    Recruiter: (Recruiter, Application.recruiter_id == Recruiter.id),
    Source: (Source, Application.source_id == Source.id),
    Role: (Role, Application.role_id == Role.id),
    BusinessUnit: (BusinessUnit, Application.business_unit_id == BusinessUnit.id),
    Interviewer: (Interviewer, Application.hiring_manager_id == Interviewer.id),
    Candidate: (Candidate, Application.candidate_id == Candidate.id),
}


@dataclass(slots=True)
class FilterSpec:
    """The API's filter surface, mirroring the front end's global filter bar."""

    date_from: dt.date | None = None
    date_to: dt.date | None = None
    recruiters: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    roles: list[str] = field(default_factory=list)
    business_units: list[str] = field(default_factory=list)
    hiring_managers: list[str] = field(default_factory=list)
    degrees: list[str] = field(default_factory=list)
    industries: list[str] = field(default_factory=list)
    outcomes: list[Outcome] = field(default_factory=list)
    stage_at_least: Stage | None = None
    stage_exactly: Stage | None = None
    experience_min: float | None = None
    experience_max: float | None = None
    repeats_only: bool | None = None
    search: str | None = None

    def cache_key(self) -> str:
        parts = [
            str(self.date_from), str(self.date_to),
            ",".join(sorted(self.recruiters)), ",".join(sorted(self.sources)),
            ",".join(sorted(self.roles)), ",".join(sorted(self.business_units)),
            ",".join(sorted(self.hiring_managers)), ",".join(sorted(self.degrees)),
            ",".join(sorted(self.industries)),
            ",".join(sorted(o.value for o in self.outcomes)),
            self.stage_at_least.value if self.stage_at_least else "",
            self.stage_exactly.value if self.stage_exactly else "",
            str(self.experience_min), str(self.experience_max),
            str(self.repeats_only), self.search or "",
        ]
        return "|".join(parts)


# ---------------------------------------------------------------------------
# Stage predicates
# ---------------------------------------------------------------------------

_STAGE_INDEX = {stage: i for i, stage in enumerate(STAGE_ORDER)}


def _reached(stage: Stage):
    """Candidates who entered `stage` or went further."""
    allowed = [s for s in STAGE_ORDER if _STAGE_INDEX[s] >= _STAGE_INDEX[stage]]
    return Application.stage_reached.in_(allowed)


def _cleared(stage: Stage):
    """Candidates who cleared `stage`'s gate, read from the bitmask."""
    bit = 1 << _STAGE_INDEX[stage]
    return Application.stage_passed_mask.op("&")(bit) == bit


def _count_where(condition) -> Any:
    return func.count(case((condition, 1)))


# ---------------------------------------------------------------------------
# Query construction
# ---------------------------------------------------------------------------


def apply_filters(stmt: Select, spec: FilterSpec) -> Select:
    """Attach every active filter, joining only the tables actually needed."""
    joined: set[Any] = set()

    def ensure(table: Any) -> None:
        if table in joined:
            return
        target, condition = _JOIN_FOR[table]
        nonlocal stmt
        stmt = stmt.join(target, condition)
        joined.add(table)

    if spec.date_from is not None:
        stmt = stmt.where(Application.applied_on >= spec.date_from)
    if spec.date_to is not None:
        stmt = stmt.where(Application.applied_on <= spec.date_to)

    if spec.recruiters:
        ensure(Recruiter)
        stmt = stmt.where(Recruiter.name.in_(spec.recruiters))
    if spec.sources:
        ensure(Source)
        stmt = stmt.where(Source.name.in_(spec.sources))
    if spec.roles:
        ensure(Role)
        stmt = stmt.where(Role.title.in_(spec.roles))
    if spec.business_units:
        ensure(BusinessUnit)
        stmt = stmt.where(BusinessUnit.name.in_(spec.business_units))
    if spec.hiring_managers:
        ensure(Interviewer)
        stmt = stmt.where(Interviewer.name.in_(spec.hiring_managers))
    needs_candidate = bool(
        spec.degrees
        or spec.industries
        or spec.search
        or spec.experience_min is not None
        or spec.experience_max is not None
    )
    if needs_candidate:
        ensure(Candidate)
    if spec.degrees:
        stmt = stmt.where(Candidate.degree.in_(spec.degrees))
    if spec.industries:
        stmt = stmt.where(Candidate.industry.in_(spec.industries))
    if spec.experience_min is not None:
        stmt = stmt.where(Candidate.experience_years >= spec.experience_min)
    if spec.experience_max is not None:
        stmt = stmt.where(Candidate.experience_years <= spec.experience_max)
    if spec.search:
        needle = f"%{spec.search.lower()}%"
        stmt = stmt.where(
            func.lower(Candidate.full_name).like(needle) | Candidate.phone.like(needle)
        )

    if spec.outcomes:
        stmt = stmt.where(Application.outcome.in_(spec.outcomes))
    if spec.stage_at_least:
        stmt = stmt.where(_reached(spec.stage_at_least))
    if spec.stage_exactly:
        stmt = stmt.where(Application.stage_reached == spec.stage_exactly)
    if spec.repeats_only is not None:
        stmt = stmt.where(Application.is_repeat.is_(spec.repeats_only))

    return stmt


# The metric expression set, shared by the summary and the group-by queries so
# a metric can never drift between the two.
def _metric_columns() -> list[Any]:
    return [
        func.count(Application.id).label("applications"),
        func.count(func.distinct(Application.candidate_id)).label("candidates"),
        _count_where(Application.is_repeat.is_(True)).label("repeat_applications"),

        _count_where(_reached(Stage.PHONE_SCREEN)).label("contacted"),
        _count_where(_reached(Stage.SALES_PITCH)).label("pitched"),
        _count_where(_reached(Stage.MANAGER_INTERVIEW)).label("manager_interviews"),
        _count_where(_reached(Stage.FINAL_INTERVIEW)).label("final_interviews"),
        _count_where(_reached(Stage.OFFER)).label("offers"),
        _count_where(_reached(Stage.JOINED)).label("joined"),

        _count_where(_cleared(Stage.SCREENED)).label("screen_eligible"),
        _count_where(_cleared(Stage.PHONE_SCREEN)).label("phone_qualified"),
        _count_where(_cleared(Stage.SALES_PITCH)).label("pitch_passed"),
        _count_where(_cleared(Stage.MANAGER_INTERVIEW)).label("manager_selected"),
        _count_where(_cleared(Stage.OFFER)).label("offers_accepted"),

        _count_where(Application.outcome == Outcome.HIRED).label("hired"),
        _count_where(Application.outcome == Outcome.IN_PROCESS).label("in_process"),
        _count_where(Application.outcome == Outcome.REJECTED).label("rejected"),
        _count_where(Application.outcome == Outcome.WITHDRAWN).label("withdrawn"),
        _count_where(Application.outcome == Outcome.DROPPED_OFF).label("dropped_off"),
        _count_where(Application.outcome == Outcome.LAPSED).label("lapsed"),

        # percentile_cont ignores NULLs, so these describe only the records
        # that actually carry the measurement — see `*_measured` below.
        func.percentile_cont(0.5)
        .within_group(Application.time_to_hire.asc())
        .label("time_to_hire_median"),
        func.percentile_cont(0.9)
        .within_group(Application.time_to_hire.asc())
        .label("time_to_hire_p90"),
        func.percentile_cont(0.5)
        .within_group(Application.time_to_offer.asc())
        .label("time_to_offer_median"),
        func.percentile_cont(0.5)
        .within_group(Application.days_to_call.asc())
        .label("days_to_call_median"),
        func.percentile_cont(0.5)
        .within_group(Application.days_offer_to_join.asc())
        .label("offer_to_join_median"),
        _count_where(Application.time_to_hire.isnot(None)).label("time_to_hire_measured"),
    ]


def _derive(row: Any) -> dict[str, Any]:
    """Turn raw counts into the rate metrics, guarding every denominator."""
    data = dict(row._mapping)

    def pct(numerator: str, denominator: str) -> float | None:
        d = data.get(denominator) or 0
        return round(data[numerator] / d * 100, 4) if d else None

    applications = data.get("applications") or 0
    hired = data.get("hired") or 0

    data["screen_pass_rate"] = pct("screen_eligible", "applications")
    data["phone_qualify_rate"] = pct("phone_qualified", "contacted")
    data["pitch_pass_rate"] = pct("pitch_passed", "pitched")
    data["manager_select_rate"] = pct("manager_selected", "manager_interviews")
    data["offer_accept_rate"] = pct("offers_accepted", "offers")
    # Denominated on offers PLACED: a few records carry a start date with no
    # acceptance logged, which would push an accepted-offer denominator past
    # 100% in small groups.
    data["join_rate"] = pct("joined", "offers")
    data["overall_conversion"] = pct("hired", "applications")
    data["no_show_rate"] = pct("dropped_off", "offers_accepted")
    data["lapse_rate"] = pct("lapsed", "applications")
    data["applications_per_hire"] = round(applications / hired, 2) if hired else None
    data["interviews_per_hire"] = (
        round((data["manager_interviews"] + data["final_interviews"]) / hired, 2)
        if hired
        else None
    )
    return data


class AnalyticsRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    # -- Summary ----------------------------------------------------------

    def summary(self, spec: FilterSpec) -> dict[str, Any]:
        stmt = apply_filters(select(*_metric_columns()), spec)
        row = self.session.execute(stmt).one()
        return _derive(row)

    # -- Funnel -----------------------------------------------------------

    def funnel(self, spec: FilterSpec) -> list[dict[str, Any]]:
        columns = []
        for stage in STAGE_ORDER:
            columns.append(_count_where(_reached(stage)).label(f"entered_{stage.value}"))
            columns.append(_count_where(_cleared(stage)).label(f"cleared_{stage.value}"))

        row = self.session.execute(apply_filters(select(*columns), spec)).one()._mapping
        intake = row[f"entered_{STAGE_ORDER[0].value}"] or 0

        out: list[dict[str, Any]] = []
        for i, stage in enumerate(STAGE_ORDER):
            entered = row[f"entered_{stage.value}"]
            cleared = row[f"cleared_{stage.value}"]
            nxt = (
                row[f"entered_{STAGE_ORDER[i + 1].value}"]
                if i + 1 < len(STAGE_ORDER)
                else None
            )
            out.append(
                {
                    "stage": stage.value,
                    "index": i,
                    "entered": entered,
                    "cleared": cleared,
                    "lost": entered - (nxt if nxt is not None else entered),
                    "pass_rate": round(cleared / entered * 100, 2) if entered else None,
                    "step_conversion": (
                        round(nxt / entered * 100, 2) if nxt is not None and entered else None
                    ),
                    "cumulative": round(entered / intake * 100, 2) if intake else None,
                }
            )
        return out

    # -- Group by ---------------------------------------------------------

    def by_dimension(
        self,
        spec: FilterSpec,
        dimension: str,
        min_applications: int = 1,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        if dimension not in DIMENSIONS:
            raise ValueError(
                f"Unknown dimension '{dimension}'. Expected one of: "
                f"{', '.join(sorted(DIMENSIONS))}."
            )
        table, label = DIMENSIONS[dimension]
        target, condition = _JOIN_FOR[table]

        stmt = select(label.label("key"), *_metric_columns()).join(target, condition)
        stmt = apply_filters(stmt, spec)
        stmt = (
            stmt.where(label.isnot(None))
            .group_by(label)
            .having(func.count(Application.id) >= min_applications)
            .order_by(func.count(Application.id).desc())
            .limit(limit)
        )
        return [_derive(row) for row in self.session.execute(stmt).all()]

    # -- Time series ------------------------------------------------------

    def timeseries(
        self, spec: FilterSpec, granularity: Granularity = "month"
    ) -> list[dict[str, Any]]:
        bucket = func.date_trunc(granularity, Application.applied_on).label("bucket")
        stmt = apply_filters(select(bucket, *_metric_columns()), spec)
        stmt = stmt.group_by(bucket).order_by(bucket)
        return [_derive(row) for row in self.session.execute(stmt).all()]

    # -- Loss analysis ----------------------------------------------------

    def loss_breakdown(
        self, spec: FilterSpec, include_inferred: bool = False
    ) -> list[dict[str, Any]]:
        """Recorded loss reasons.

        Inferred reasons are excluded by default: they outnumber the recorded
        ones roughly nine to one, and mixing them buries every reason a
        recruiter could actually act on.
        """
        stmt = select(
            Application.loss_category.label("category"),
            Application.loss_reason.label("reason"),
            Application.exit_stage.label("exit_stage"),
            func.count(Application.id).label("candidates"),
        )
        stmt = apply_filters(stmt, spec).where(Application.loss_category.isnot(None))
        if not include_inferred:
            stmt = stmt.where(Application.loss_inferred.is_(False))
        stmt = stmt.group_by(
            Application.loss_category, Application.loss_reason, Application.exit_stage
        ).order_by(func.count(Application.id).desc())
        return [dict(row._mapping) for row in self.session.execute(stmt).all()]

    # -- Aging ------------------------------------------------------------

    def aging(self, spec: FilterSpec) -> list[dict[str, Any]]:
        bucket = case(
            (Application.days_idle <= 7, "0-7"),
            (Application.days_idle <= 14, "8-14"),
            (Application.days_idle <= 30, "15-30"),
            (Application.days_idle <= 45, "31-45"),
            (Application.days_idle <= 90, "46-90"),
            else_="90+",
        ).label("bucket")

        stmt = select(
            bucket,
            Application.stage_reached.label("stage"),
            func.count(Application.id).label("applications"),
        )
        stmt = apply_filters(stmt, spec).where(
            Application.outcome.in_([Outcome.IN_PROCESS, Outcome.LAPSED]),
            Application.days_idle.isnot(None),
        )
        stmt = stmt.group_by(bucket, Application.stage_reached)
        return [dict(row._mapping) for row in self.session.execute(stmt).all()]

    # -- Candidate list ---------------------------------------------------

    def applications(
        self, spec: FilterSpec, offset: int = 0, limit: int = 100
    ) -> tuple[int, list[Application]]:
        base = apply_filters(select(Application.id), spec).subquery()
        total = self.session.execute(
            select(func.count()).select_from(base)
        ).scalar_one()

        stmt = apply_filters(select(Application), spec)
        stmt = (
            stmt.order_by(Application.applied_on.desc(), Application.id.desc())
            .offset(offset)
            .limit(min(limit, 500))
        )
        return total, list(self.session.execute(stmt).scalars().all())

    # -- Distinct values for the filter bar -------------------------------

    def dimension_values(self, dimension: str) -> list[str]:
        if dimension not in DIMENSIONS:
            raise ValueError(f"Unknown dimension '{dimension}'.")
        _, label = DIMENSIONS[dimension]
        stmt = select(label).where(label.isnot(None)).distinct().order_by(label)
        return [row[0] for row in self.session.execute(stmt).all()]
