"""SQLAlchemy models for the recruitment warehouse.

The schema is deliberately analytics-shaped rather than transactional: one wide
`applications` row per application with the stage dates and verdicts inlined,
plus small dimension tables for the entities the UI groups by. Recruitment
volume here is tens of thousands of rows a year, so the cost of a wide table is
trivial next to the cost of joining six tables on every dashboard query.
"""

from __future__ import annotations

import datetime as dt
import enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Outcome(str, enum.Enum):
    IN_PROCESS = "In Process"
    HIRED = "Hired"
    REJECTED = "Rejected"
    WITHDRAWN = "Withdrawn"
    DROPPED_OFF = "Dropped Off"
    LAPSED = "Lapsed"


class Stage(str, enum.Enum):
    APPLIED = "applied"
    SCREENED = "screened"
    PHONE_SCREEN = "phone_screen"
    ASSESSMENT = "assessment"
    SALES_PITCH = "sales_pitch"
    MANAGER_INTERVIEW = "manager_interview"
    FINAL_INTERVIEW = "final_interview"
    OFFER = "offer"
    JOINED = "joined"


STAGE_ORDER: list[Stage] = list(Stage)


# ---------------------------------------------------------------------------
# Dimensions
# ---------------------------------------------------------------------------


class Recruiter(Base):
    __tablename__ = "recruiters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_on: Mapped[dt.date | None] = mapped_column(Date)

    applications: Mapped[list[Application]] = relationship(back_populates="recruiter")


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    channel: Mapped[str | None] = mapped_column(String(40), index=True)
    # Cost is captured per source so cost-per-hire can be derived once
    # finance supplies the figures; nullable until then.
    monthly_cost: Mapped[float | None] = mapped_column(Float)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    family: Mapped[str | None] = mapped_column(String(60))
    seniority: Mapped[str | None] = mapped_column(String(40))


class BusinessUnit(Base):
    __tablename__ = "business_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    director: Mapped[str | None] = mapped_column(String(120))


class Interviewer(Base):
    __tablename__ = "interviewers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    business_unit_id: Mapped[int | None] = mapped_column(ForeignKey("business_units.id"))


class Candidate(Base):
    """A person. Distinct from an application — people re-apply.

    Roughly a fifth of the applications in the source sheet come from someone
    who has applied before, so collapsing person and application would
    overstate the size of the addressable market by the same margin.
    """

    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Normalised phone is the only reliable identity key in the source data:
    # emails are largely absent and names are far from unique.
    phone: Mapped[str | None] = mapped_column(String(20), index=True)
    full_name: Mapped[str] = mapped_column(String(160), index=True)
    email: Mapped[str | None] = mapped_column(String(200))
    cnic: Mapped[str | None] = mapped_column(String(20))
    city: Mapped[str | None] = mapped_column(String(80), index=True)
    degree: Mapped[str | None] = mapped_column(String(40), index=True)
    institute: Mapped[str | None] = mapped_column(String(160), index=True)
    industry: Mapped[str | None] = mapped_column(String(80), index=True)
    experience_years: Mapped[float | None] = mapped_column(Float)
    last_salary: Mapped[int | None] = mapped_column(Integer)

    applications: Mapped[list[Application]] = relationship(back_populates="candidate")

    __table_args__ = (
        UniqueConstraint("phone", name="uq_candidate_phone"),
        Index("ix_candidate_profile", "degree", "industry"),
    )


# ---------------------------------------------------------------------------
# Fact table
# ---------------------------------------------------------------------------


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stable hash of the source row so re-syncs update rather than duplicate.
    source_row_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"), index=True)
    recruiter_id: Mapped[int | None] = mapped_column(ForeignKey("recruiters.id"), index=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"), index=True)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), index=True)
    hiring_manager_id: Mapped[int | None] = mapped_column(ForeignKey("interviewers.id"), index=True)
    business_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_units.id"), index=True
    )

    # ---- Position -------------------------------------------------------
    applied_on: Mapped[dt.date] = mapped_column(Date, index=True)
    stage_reached: Mapped[Stage] = mapped_column(Enum(Stage), index=True)
    # Bitmask of cleared stages — one integer answers "did they pass stage N"
    # for every N without a per-stage column or a join.
    stage_passed_mask: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[Outcome] = mapped_column(Enum(Outcome), index=True)
    exit_stage: Mapped[Stage | None] = mapped_column(Enum(Stage), index=True)

    # ---- Stage dates ----------------------------------------------------
    call_on: Mapped[dt.date | None] = mapped_column(Date)
    assessment_on: Mapped[dt.date | None] = mapped_column(Date)
    sales_pitch_on: Mapped[dt.date | None] = mapped_column(Date)
    manager_interview_on: Mapped[dt.date | None] = mapped_column(Date)
    final_interview_on: Mapped[dt.date | None] = mapped_column(Date)
    offer_on: Mapped[dt.date | None] = mapped_column(Date)
    planned_start_on: Mapped[dt.date | None] = mapped_column(Date)
    actual_start_on: Mapped[dt.date | None] = mapped_column(Date, index=True)
    last_activity_on: Mapped[dt.date | None] = mapped_column(Date, index=True)

    # ---- Verdicts -------------------------------------------------------
    screen_status: Mapped[str | None] = mapped_column(String(40))
    call_status: Mapped[str | None] = mapped_column(String(40))
    assessment_status: Mapped[str | None] = mapped_column(String(40))
    sales_pitch_status: Mapped[str | None] = mapped_column(String(40), index=True)
    manager_status: Mapped[str | None] = mapped_column(String(40))
    final_status: Mapped[str | None] = mapped_column(String(40))
    offer_status: Mapped[str | None] = mapped_column(String(40))
    final_disposition: Mapped[str | None] = mapped_column(String(60))

    # ---- Loss attribution ------------------------------------------------
    loss_category: Mapped[str | None] = mapped_column(String(40), index=True)
    loss_reason: Mapped[str | None] = mapped_column(String(120), index=True)
    # True when the loss reason was inferred from inactivity rather than
    # recorded by a recruiter. The UI reports the two separately.
    loss_inferred: Mapped[bool] = mapped_column(Boolean, default=False)

    # ---- Precomputed durations ------------------------------------------
    days_to_call: Mapped[int | None] = mapped_column(SmallInteger)
    days_call_to_assessment: Mapped[int | None] = mapped_column(SmallInteger)
    days_assessment_to_pitch: Mapped[int | None] = mapped_column(SmallInteger)
    days_pitch_to_manager: Mapped[int | None] = mapped_column(SmallInteger)
    days_manager_to_final: Mapped[int | None] = mapped_column(SmallInteger)
    days_final_to_offer: Mapped[int | None] = mapped_column(SmallInteger)
    days_offer_to_join: Mapped[int | None] = mapped_column(SmallInteger)
    time_to_offer: Mapped[int | None] = mapped_column(SmallInteger)
    time_to_hire: Mapped[int | None] = mapped_column(SmallInteger)
    start_date_slip: Mapped[int | None] = mapped_column(SmallInteger)
    days_idle: Mapped[int | None] = mapped_column(SmallInteger)

    # ---- Misc ------------------------------------------------------------
    application_seq: Mapped[int] = mapped_column(SmallInteger, default=1)
    is_repeat: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    campaign: Mapped[str | None] = mapped_column(String(60))
    remarks: Mapped[str | None] = mapped_column(Text)

    synced_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    candidate: Mapped[Candidate] = relationship(back_populates="applications")
    recruiter: Mapped[Recruiter | None] = relationship(back_populates="applications")

    __table_args__ = (
        # The dashboard's dominant access pattern is "a date window sliced by
        # one dimension", so every hot filter pairs with applied_on.
        Index("ix_app_date_recruiter", "applied_on", "recruiter_id"),
        Index("ix_app_date_source", "applied_on", "source_id"),
        Index("ix_app_date_role", "applied_on", "role_id"),
        Index("ix_app_date_outcome", "applied_on", "outcome"),
        Index("ix_app_stage_outcome", "stage_reached", "outcome"),
        Index("ix_app_idle", "outcome", "days_idle"),
    )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditLog(Base):
    """Every read of candidate-level data and every export is recorded.

    Recruitment records are personal data; who looked at what, and who took a
    copy of it off the platform, has to be answerable.
    """

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    occurred_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    actor_email: Mapped[str] = mapped_column(String(200), index=True)
    actor_role: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(60), index=True)
    resource: Mapped[str] = mapped_column(String(120))
    # Filter scope the action was performed under, as JSON text.
    scope: Mapped[str | None] = mapped_column(Text)
    row_count: Mapped[int | None] = mapped_column(Integer)
    ip_address: Mapped[str | None] = mapped_column(String(64))


class SyncRun(Base):
    """One Google Sheets ingestion attempt."""

    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)
    rows_read: Mapped[int] = mapped_column(Integer, default=0)
    rows_written: Mapped[int] = mapped_column(Integer, default=0)
    rows_rejected: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
