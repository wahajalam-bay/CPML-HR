"""Google Sheets ingestion.

The operational sheet is hand-maintained: columns drift, notes land in ID
fields, dates arrive as free text and salaries as prose. The cleaning rules
here are the same ones proven against the real export in `etl/normalize.py` —
that script is the offline reference implementation, this is the scheduled one.

Nothing is ever written back to the sheet. Recruiters own it; this service
maintains a read-optimised projection of it.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
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

log = logging.getLogger(__name__)

STALE_AFTER_DAYS = 45


@dataclass(slots=True)
class IngestResult:
    rows_read: int = 0
    rows_written: int = 0
    rows_rejected: int = 0


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------

_WS = re.compile(r"\s+")
_DIGITS = re.compile(r"\D+")
_SALARY = re.compile(r"(\d[\d,]*\.?\d*)\s*(k|lac|lakh)?", re.I)
_DATE_TEXT = re.compile(
    r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-/ ]\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{2,4})"
)
_MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}

SOURCE_MAP = {
    "linkedin": "LinkedIn",
    "self sourced": "Self Sourced",
    "self-sourced": "Self Sourced",
    "open house campaign": "Open House",
    "openhouse": "Open House",
    "referral": "Referral",
    "refferal": "Referral",
    "indeed": "Indeed",
    "hr-walk in": "Walk-In",
    "walkin": "Walk-In",
    "recruitment drive b64": "Recruitment Drive",
    "rozee": "Rozee",
}

SOURCE_CHANNEL = {
    "LinkedIn": "Job Board",
    "Indeed": "Job Board",
    "Rozee": "Job Board",
    "Referral": "Referral",
    "Self Sourced": "Outbound",
    "Open House": "Event",
    "Recruitment Drive": "Event",
    "Walk-In": "Walk-In",
}

REASON_TAXONOMY: dict[str, tuple[str, str]] = {
    "location": ("Logistics", "Location"),
    "no conveyance": ("Logistics", "No Conveyance"),
    "weekdays/timing": ("Logistics", "Timings"),
    "undergraduate": ("Eligibility", "Undergraduate"),
    "studying": ("Eligibility", "Still Studying"),
    "aged": ("Eligibility", "Age Criteria"),
    "ex-zameen/empg/olx": ("Eligibility", "Group Alumni Policy"),
    "high expectation": ("Compensation", "Salary Expectation"),
    "salary": ("Compensation", "Salary Expectation"),
    "got another job": ("Competition", "Accepted Other Offer"),
    "not interested in sales jobs": ("Motivation", "Not Interested in Sales"),
    "not interested": ("Motivation", "Disengaged"),
    "personal reasons": ("Motivation", "Personal Reasons"),
    "not suitable": ("Capability", "Not Suitable"),
    "poor communication skills": ("Capability", "Communication"),
    "behavioral issues": ("Capability", "Behavioural"),
}


def clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = _WS.sub(" ", value).strip()
        return text or None if text not in {"-", "--", "N/A", "########"} else None
    return str(value).strip() or None


def parse_date(value: Any) -> dt.date | None:
    """Accept real dates, Excel serials, and the hand-typed variants."""
    if isinstance(value, dt.datetime):
        candidate = value.date()
    elif isinstance(value, dt.date):
        candidate = value
    elif isinstance(value, int | float) and not isinstance(value, bool):
        if not 40000 <= value <= 50000:
            return None
        candidate = dt.date(1899, 12, 30) + dt.timedelta(days=int(value))
    elif isinstance(value, str):
        match = _DATE_TEXT.search(value)
        if not match:
            return None
        month = match.group(2)[:3].lower()
        if month not in _MONTHS:
            return None
        year = int(match.group(3))
        year += 2000 if year < 100 else 0
        try:
            candidate = dt.date(year, _MONTHS[month], int(match.group(1)))
        except ValueError:
            return None
    else:
        return None

    # Anything outside the operating window is a typo, not a date.
    return candidate if dt.date(2020, 1, 1) <= candidate <= dt.date(2035, 12, 31) else None


def parse_salary(value: Any) -> int | None:
    """'50k', '60k base plus incentives', '50-60k', 96000 -> PKR per month."""
    if isinstance(value, int | float) and not isinstance(value, bool):
        amount = float(value)
    elif isinstance(value, str):
        found = _SALARY.findall(value.lower().replace(",", ""))
        amounts: list[float] = []
        for raw, suffix in found:
            try:
                n = float(raw)
            except ValueError:
                continue
            if suffix in {"lac", "lakh"}:
                n *= 100_000
            elif suffix == "k" or n < 1_000:
                n *= 1_000
            amounts.append(n)
        amounts = [n for n in amounts if 10_000 <= n <= 2_000_000]
        if not amounts:
            return None
        amount = sum(amounts[:2]) / len(amounts[:2])  # "50-60k" -> midpoint
    else:
        return None

    if amount < 1_000:
        amount *= 1_000
    if not 10_000 <= amount <= 2_000_000:
        return None
    return int(round(amount / 500) * 500)


def parse_phone(value: Any) -> str | None:
    """Normalise to the Pakistani mobile format 03XXXXXXXXX."""
    if value is None:
        return None
    raw = f"{int(value)}" if isinstance(value, float) and value.is_integer() else str(value)
    digits = _DIGITS.sub("", raw)
    if digits.startswith("92") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif len(digits) == 10 and digits.startswith("3"):
        digits = "0" + digits
    return digits if re.fullmatch(r"03\d{9}", digits) else None


def classify_reason(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    key = value.lower().strip()
    if key in REASON_TAXONOMY:
        return REASON_TAXONOMY[key]
    return "Other", value.title()


def days_between(a: dt.date | None, b: dt.date | None) -> int | None:
    if a is None or b is None:
        return None
    delta = (b - a).days
    # Negative beyond a couple of days, or beyond a year, is a data-entry
    # error rather than a real duration.
    return delta if -5 <= delta <= 400 else None


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


class SheetsIngestor:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()
        self._dimension_cache: dict[tuple[str, str], int] = {}

    # -- Dimension upserts -------------------------------------------------

    def _dimension_id(
        self, model: type, key_field: str, value: str | None, **extra: Any
    ) -> int | None:
        if not value:
            return None
        cache_key = (model.__name__, value)
        if cache_key in self._dimension_cache:
            return self._dimension_cache[cache_key]

        column = getattr(model, key_field)
        found = self.session.execute(select(model).where(column == value)).scalar_one_or_none()
        if found is None:
            found = model(**{key_field: value}, **extra)
            self.session.add(found)
            self.session.flush()
        self._dimension_cache[cache_key] = found.id
        return found.id

    # -- Main --------------------------------------------------------------

    def run(self, full_refresh: bool = False) -> IngestResult:
        rows = self._fetch_rows()
        result = IngestResult(rows_read=len(rows))
        if not rows:
            return result

        horizon = max(
            (d for d in (parse_date(r.get("Date")) for r in rows) if d),
            default=dt.date.today(),
        )

        if full_refresh:
            self.session.query(Application).delete()
            self.session.flush()

        # Application sequence per person, so re-applications can be counted.
        seen_phone: dict[str, int] = {}
        # Occurrences of each identity tuple, so two rows that share one still
        # get distinct keys. See _row_key.
        seen_tuple: dict[str, int] = {}

        for row in rows:
            try:
                built = self._build(row, horizon, seen_phone, seen_tuple)
                if built is None:
                    result.rows_rejected += 1
                    continue
                self.session.merge(built)
                result.rows_written += 1
            except Exception as exc:  # noqa: BLE001
                result.rows_rejected += 1
                log.warning("Rejected row: %s", exc)

        self.session.commit()
        return result

    def _fetch_rows(self) -> list[dict[str, Any]]:
        if not self.settings.sheets_spreadsheet_id:
            log.warning("No spreadsheet configured; nothing to sync.")
            return []

        import gspread
        from google.oauth2.service_account import Credentials

        credentials = Credentials.from_service_account_file(
            self.settings.sheets_service_account_json,
            scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
        )
        client = gspread.authorize(credentials)
        worksheet = client.open_by_key(self.settings.sheets_spreadsheet_id).worksheet(
            self.settings.sheets_worksheet
        )
        return worksheet.get_all_records(expected_headers=[])

    def _build(
        self,
        row: dict[str, Any],
        horizon: dt.date,
        seen_phone: dict[str, int],
        seen_tuple: dict[str, int],
    ) -> Application | None:
        applied_on = parse_date(row.get("Date"))
        call_on = parse_date(row.get("Date of Call"))
        assessment_on = parse_date(row.get("Date of Assessment"))
        pitch_on = parse_date(row.get("Date of SP"))
        manager_on = parse_date(row.get("Interview Date"))
        final_on = parse_date(row.get("Actual  Final Interview  Start")) or parse_date(
            row.get("Final Interviewer")
        )
        offer_on = parse_date(row.get("Date of\nOffer Placed"))
        planned_start = parse_date(row.get("Planned DOJ"))
        actual_start = parse_date(row.get("Actual DOJ"))

        anchor = applied_on or call_on or assessment_on or pitch_on
        if anchor is None:
            return None

        name = clean(row.get("Candidate Name")) or "Unknown Candidate"
        phone = parse_phone(row.get("Candidate Phone"))

        # -- Candidate -----------------------------------------------------
        candidate: Candidate | None = None
        if phone:
            candidate = self.session.execute(
                select(Candidate).where(Candidate.phone == phone)
            ).scalar_one_or_none()
        if candidate is None:
            candidate = Candidate(phone=phone, full_name=name)
            self.session.add(candidate)
        candidate.full_name = name
        candidate.city = clean(row.get("For City")) or candidate.city
        candidate.degree = clean(row.get("Degree")) or candidate.degree
        candidate.institute = clean(row.get("Institute")) or candidate.institute
        candidate.industry = clean(row.get("Last Industry")) or candidate.industry
        candidate.last_salary = parse_salary(row.get("Last Drawn Salary")) or candidate.last_salary
        try:
            years = float(row.get("Total Past Experience\n(Yrs)") or "")
            candidate.experience_years = years if 0 <= years <= 45 else None
        except (TypeError, ValueError):
            pass
        self.session.flush()

        # -- Stage reach and clearance ------------------------------------
        statuses = {
            "screen": clean(row.get("Initial Screening Status")),
            "call": clean(row.get("Interview Assessment")),
            "assessment": clean(row.get("Assessment Status")),
            "pitch": clean(row.get("SP Status")),
            "manager": clean(row.get("Initial Interview\n Status")),
            "final": clean(row.get("Final Interview\n Status")),
            "offer": clean(row.get("Offer Status")),
        }
        disposition = clean(row.get("Final Status"))

        reached = 0
        if statuses["screen"]:
            reached = max(reached, 1)
        if statuses["call"] or call_on:
            reached = max(reached, 2)
        if statuses["assessment"] or assessment_on:
            reached = max(reached, 3)
        if statuses["pitch"] or pitch_on:
            reached = max(reached, 4)
        if statuses["manager"] or manager_on or clean(row.get("BMD In-person Interview")):
            reached = max(reached, 5)
        if statuses["final"] or final_on:
            reached = max(reached, 6)
        if statuses["offer"] or offer_on:
            reached = max(reached, 7)
        joined = bool(actual_start) or (disposition or "").lower() in {"onboarded", "in-training"}
        if joined:
            reached = max(reached, 8)

        passed = 1  # applied is always cleared
        gates = [
            (1, statuses["screen"], {"eligible"}),
            (2, statuses["call"], {"qualified"}),
            (3, statuses["assessment"], {"qualified"}),
            (4, statuses["pitch"], {"sp+"}),
            (5, statuses["manager"], {"selected"}),
            (6, statuses["final"], {"selected"}),
            (7, statuses["offer"], {"accepted"}),
        ]
        for bit, status_value, positives in gates:
            if status_value and status_value.lower() in positives:
                passed |= 1 << bit
        if joined:
            passed |= 1 << 8

        # -- Outcome -------------------------------------------------------
        no_show = (disposition or "").lower() in {
            "did not join training",
            "did not join after training",
            "required documents not submitted",
        }
        withdrew = any(
            (s or "").lower() in {"not interested", "left without interview", "not attended"}
            for s in statuses.values()
        )
        failed_gate = any(
            status_value
            and status_value.lower() not in positives
            and status_value.lower() != "pending"
            for _, status_value, positives in gates
        )

        activity = [
            d
            for d in (
                anchor, call_on, assessment_on, pitch_on,
                manager_on, final_on, offer_on, actual_start,
            )
            if d
        ]
        last_activity = max(activity) if activity else anchor
        idle = (horizon - last_activity).days

        if joined:
            outcome = Outcome.HIRED
        elif no_show:
            outcome = Outcome.DROPPED_OFF
        elif withdrew or (statuses["offer"] or "").lower() == "rejected":
            outcome = Outcome.WITHDRAWN
        elif failed_gate:
            outcome = Outcome.REJECTED
        elif idle > STALE_AFTER_DAYS and reached < 7:
            outcome = Outcome.LAPSED
        else:
            outcome = Outcome.IN_PROCESS

        loss_category, loss_reason = classify_reason(
            clean(row.get("Reason\n(if offer rejected)"))
            or clean(row.get("Reason\n(if Not Qualified)"))
            or clean(row.get("Reason"))
        )
        loss_inferred = False
        if loss_category is None and outcome is Outcome.LAPSED:
            loss_category, loss_reason, loss_inferred = "Contactability", "Went Cold", True

        # -- Sequence ------------------------------------------------------
        key = phone or f"n:{name.lower()}"
        seen_phone[key] = seen_phone.get(key, 0) + 1
        sequence = seen_phone[key]

        raw_source = clean(row.get("Source"))
        source_name = SOURCE_MAP.get((raw_source or "").lower(), raw_source)

        return Application(
            source_row_key=_row_key(row, seen_tuple),
            candidate_id=candidate.id,
            recruiter_id=self._dimension_id(Recruiter, "name", clean(row.get("HR Person"))),
            source_id=self._dimension_id(
                Source, "name", source_name, channel=SOURCE_CHANNEL.get(source_name or "")
            ),
            role_id=self._dimension_id(Role, "title", clean(row.get("Designation"))),
            hiring_manager_id=self._dimension_id(
                Interviewer, "name", clean(row.get("BMD In-person Interview"))
            ),
            business_unit_id=self._dimension_id(BusinessUnit, "name", clean(row.get("Team"))),
            applied_on=anchor,
            stage_reached=STAGE_ORDER[reached],
            stage_passed_mask=passed,
            outcome=outcome,
            exit_stage=STAGE_ORDER[reached] if outcome is not Outcome.IN_PROCESS else None,
            call_on=call_on,
            assessment_on=assessment_on,
            sales_pitch_on=pitch_on,
            manager_interview_on=manager_on,
            final_interview_on=final_on,
            offer_on=offer_on,
            planned_start_on=planned_start,
            actual_start_on=actual_start,
            last_activity_on=last_activity,
            screen_status=statuses["screen"],
            call_status=statuses["call"],
            assessment_status=statuses["assessment"],
            sales_pitch_status=statuses["pitch"],
            manager_status=statuses["manager"],
            final_status=statuses["final"],
            offer_status=statuses["offer"],
            final_disposition=disposition,
            loss_category=loss_category,
            loss_reason=loss_reason,
            loss_inferred=loss_inferred,
            days_to_call=days_between(anchor, call_on),
            days_call_to_assessment=days_between(call_on, assessment_on),
            days_assessment_to_pitch=days_between(assessment_on, pitch_on),
            days_pitch_to_manager=days_between(pitch_on, manager_on),
            days_manager_to_final=days_between(manager_on, final_on),
            days_final_to_offer=days_between(final_on, offer_on),
            days_offer_to_join=days_between(offer_on, actual_start),
            time_to_offer=days_between(anchor, offer_on),
            time_to_hire=days_between(anchor, actual_start),
            start_date_slip=days_between(planned_start, actual_start),
            days_idle=idle,
            application_seq=sequence,
            is_repeat=sequence > 1,
            campaign=clean(row.get("Project Drive/Non Project Drive")),
            remarks=clean(row.get("Initial Remarks")) or clean(row.get("Remarks")),
        )


def _row_key(row: dict[str, Any], seen_tuple: dict[str, int]) -> str:
    """Stable identity for a sheet row so re-syncs update rather than duplicate.

    The sheet has no primary key, so identity starts from the tuple that
    describes an application: who applied, when, and for what.

    That tuple is not unique. 965 of the 28,366 rows share one with another row
    -- a walk-in drive can log the same person for the same role twice in a day
    -- so keying on it alone silently discards those rows on merge, and the
    warehouse ends up holding fewer applications than the sheet does.

    The occurrence ordinal within the group closes that. Rows arrive in sheet
    order on every sync, so the ordinal is stable and a re-sync still updates
    rather than duplicating.

    Must match ``rowKey`` in web/scripts/seed.ts.
    """
    parts = [
        str(row.get("Candidate Phone", "")),
        str(row.get("Candidate Name", "")),
        str(row.get("Date", "")),
        str(row.get("Designation", "")),
    ]
    tuple_key = "|".join(parts)
    occurrence = seen_tuple.get(tuple_key, 0)
    seen_tuple[tuple_key] = occurrence + 1

    return hashlib.sha256(
        "|".join([*parts, str(occurrence)]).encode("utf-8")
    ).hexdigest()[:32]


__all__ = ["SheetsIngestor", "IngestResult", "Stage"]
