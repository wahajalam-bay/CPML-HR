"""
CPML Recruitment Command Center — ETL / Normalization layer.

Reads the operational Google-Sheets export (`CPML Recruitment Sheet 2025-2026
Updated.xlsx`) and produces two canonical artifacts:

  1. data/canonical.jsonl      one clean record per application (backend seed)
  2. web/public/data/store.json  dictionary-encoded columnar store (browser)

The source sheet is a hand-maintained operational tracker: columns drift, notes
land in ID fields, dates arrive as strings, and salaries are free text. Every
cleaning rule below is derived from an exhaustive profile of the real column
contents (see etl/PROFILE.md), not from guesswork.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Any, Iterable

import openpyxl

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE = os.path.join(os.path.dirname(ROOT), "CPML Recruitment Sheet 2025-2026 Updated.xlsx")
DATA_DIR = os.path.join(ROOT, "data")
WEB_DATA_DIR = os.path.join(ROOT, "web", "public", "data")

EPOCH = dt.date(2024, 1, 1)
DATE_MIN = dt.date(2024, 1, 1)
DATE_MAX = dt.date(2026, 12, 31)

# --------------------------------------------------------------------------
# Column map (0-indexed against Sheet1)
# --------------------------------------------------------------------------

C = {
    "applied_date": 0,
    "source": 1,
    "reference": 2,
    "city": 3,
    "applied_role": 4,
    "drive": 5,
    "phone": 6,
    "name": 7,
    "cnic": 8,
    "email": 9,
    "industry": 10,
    "experience": 11,
    "degree": 12,
    "institute": 13,
    "recruiter": 14,
    "screen_status": 15,
    "screen_reason": 16,
    "screen_remarks": 17,
    "call_date": 18,
    "call_status": 19,
    "current_salary": 20,
    "call_reason": 21,
    "assessment_date": 22,
    "assessment_status": 23,
    "sp_date": 24,
    "sp_status": 25,
    "sp_comment": 26,
    "hiring_manager": 27,
    "mgr_interview_date": 28,
    "mgr_interview_start": 29,
    "mgr_interview_end": 30,
    "mgr_interview_status": 31,
    "mgr_interview_reason": 32,
    "final_interviewer": 33,
    "final_planned": 34,
    "final_start": 35,
    "final_end": 36,
    "final_status": 37,
    "final_reason": 38,
    "director": 39,
    "outcome_status": 40,
    "offer_date": 41,
    "offer_status": 42,
    "offer_reason": 43,
    "hired_role": 44,
    "team": 45,
    "planned_doj": 46,
    "actual_doj": 47,
    "remarks": 48,
}
NCOL = 50

# --------------------------------------------------------------------------
# Canonical vocabularies
# --------------------------------------------------------------------------

SOURCE_MAP = {
    "linkedin": "LinkedIn",
    "self sourced": "Self Sourced",
    "self-sourced": "Self Sourced",
    "self source": "Self Sourced",
    "open house campaign": "Open House",
    "open house jan 2026 lead": "Open House",
    "openhouse": "Open House",
    "open house": "Open House",
    "referral": "Referral",
    "refferal": "Referral",
    "indeed": "Indeed",
    "hr-walk in": "Walk-In",
    "walkin": "Walk-In",
    "walk in": "Walk-In",
    "recruitment drive b64": "Recruitment Drive",
    "rozee": "Rozee",
    "telesales": "Telesales",
    "breezy": "Breezy",
}

# Source → acquisition channel family (paid / owned / earned / outbound)
SOURCE_CHANNEL = {
    "LinkedIn": "Job Board",
    "Indeed": "Job Board",
    "Rozee": "Job Board",
    "Breezy": "Job Board",
    "Referral": "Referral",
    "Self Sourced": "Outbound",
    "Telesales": "Outbound",
    "Open House": "Event",
    "Recruitment Drive": "Event",
    "Walk-In": "Walk-In",
}

ROLE_MAP = {
    "associate/am": "Associate / AM",
    "business development manager": "Business Development Manager",
    "sbdm": "Senior BDM",
    "account manager- classified main": "Account Manager — Classified",
    "account manager - sales": "Account Manager — Sales",
    "sales manager": "Sales Manager",
}

HIRED_ROLE_MAP = {
    "ambd": "AM — Business Development",
    "bda": "Business Development Associate",
    "bdm i": "BDM I",
    "bdm ii": "BDM II",
    "bdm": "BDM",
    "sbdm": "Senior BDM",
    "sm": "Sales Manager",
    "esm": "Enterprise Sales Manager",
}

DEGREE_MAP = {
    "graduation": "Graduate",
    "masters": "Masters",
    "undergraduate": "Undergraduate",
}
DEGREE_RANK = {"Undergraduate": 0, "Graduate": 1, "Masters": 2}

# Institute canonicalisation — collapses the long tail of spelling variants
# that the profile exposed (UMT/NCBAE/FC College/Riphah/AIOU families).
INSTITUTE_MAP = {
    "punjab university": "University of the Punjab",
    "university of punjab": "University of the Punjab",
    "pu": "University of the Punjab",
    "university of central punjab": "University of Central Punjab",
    "ucp": "University of Central Punjab",
    "virtual university": "Virtual University",
    "vu": "Virtual University",
    "superior university": "Superior University",
    "gc university": "GC University",
    "government college university": "GC University",
    "gcu": "GC University",
    "aiou": "Allama Iqbal Open University",
    "allama iqbal open university": "Allama Iqbal Open University",
    "university of management and technology": "UMT",
    "umt": "UMT",
    "comsats university": "COMSATS University",
    "comsats": "COMSATS University",
    "university of the lahore": "University of Lahore",
    "university of lahore": "University of Lahore",
    "lahore university": "University of Lahore",
    "uol": "University of Lahore",
    "university of education": "University of Education",
    "bzu multan": "Bahauddin Zakariya University",
    "bzu": "Bahauddin Zakariya University",
    "lahore school of economics": "Lahore School of Economics",
    "lse": "Lahore School of Economics",
    "ncbae": "NCBA&E",
    "ncba&e": "NCBA&E",
    "bise lahore": "BISE Lahore",
    "islamia university bahawalpur": "Islamia University Bahawalpur",
    "islamia university": "Islamia University Bahawalpur",
    "university of engineering & technology": "UET Lahore",
    "university engineering and technology": "UET Lahore",
    "uet": "UET Lahore",
    "uet lahore": "UET Lahore",
    "university of south asia": "University of South Asia",
    "lahore garrison university": "Lahore Garrison University",
    "fc college": "FC College",
    "fc college lahore": "FC College",
    "forman christian college": "FC College",
    "ripah university": "Riphah International University",
    "riphah university": "Riphah International University",
    "riphah international university": "Riphah International University",
    "minhaj university": "Minhaj University",
    "numl": "NUML",
    "(numl) lahore": "NUML",
    "numl lahore": "NUML",
    "lums": "LUMS",
    "lahore leads university": "Lahore Leads University",
    "university of okara": "University of Okara",
    "government college university faisalabad": "GC University Faisalabad",
    "gcuf": "GC University Faisalabad",
    "lahore college for women university": "Lahore College for Women University",
    "lcwu": "Lahore College for Women University",
    "university of sargodha": "University of Sargodha",
    "sargodha univeristy": "University of Sargodha",
    "sargodha university": "University of Sargodha",
    "hajvery university": "Hajvery University",
    "beaconhouse national university": "Beaconhouse National University",
    "bnu": "Beaconhouse National University",
    "fast": "FAST-NUCES",
    "fast nuces": "FAST-NUCES",
    "university of agriculture faisalabad": "University of Agriculture Faisalabad",
    "university of karachi": "University of Karachi",
}

# Screening/qualification reasons → a small analysable taxonomy.
# (category, canonical label)
REASON_TAXONOMY = {
    "location": ("Logistics", "Location"),
    "no conveyance": ("Logistics", "No Conveyance"),
    "travelling issue": ("Logistics", "Travel / Commute"),
    "weekdays/timing": ("Logistics", "Timings"),
    "timings": ("Logistics", "Timings"),
    "undergraduate": ("Eligibility", "Undergraduate"),
    "studying": ("Eligibility", "Still Studying"),
    "aged": ("Eligibility", "Age Criteria"),
    "lawyer": ("Eligibility", "Restricted Profession"),
    "overqualified": ("Eligibility", "Overqualified"),
    "ex-zameen/empg/olx": ("Eligibility", "Group Alumni Policy"),
    "wrongly applied": ("Eligibility", "Wrongly Applied"),
    "wrong number": ("Contactability", "Bad Contact Detail"),
    "na": ("Contactability", "Unreachable"),
    "high expectation": ("Compensation", "Salary Expectation"),
    "salary": ("Compensation", "Salary Expectation"),
    "retention": ("Compensation", "Counter-Offered"),
    "new offer": ("Competition", "Accepted Other Offer"),
    "got another job": ("Competition", "Accepted Other Offer"),
    "not interested in sales jobs": ("Motivation", "Not Interested in Sales"),
    "not interested": ("Motivation", "Disengaged"),
    "needs time to think; hence marked not interested": ("Motivation", "Disengaged"),
    "unresponsive candidate": ("Motivation", "Disengaged"),
    "personal reasons": ("Motivation", "Personal Reasons"),
    "planning to move abroad": ("Motivation", "Relocating Abroad"),
    "own business": ("Motivation", "Own Business"),
    "not suitable": ("Capability", "Not Suitable"),
    "poor communication skills": ("Capability", "Communication"),
    "communication": ("Capability", "Communication"),
    "behavioral issues": ("Capability", "Behavioural"),
    "rejected in sales pitch": ("Capability", "Failed Sales Pitch"),
    "sp-": ("Capability", "Failed Sales Pitch"),
    "scheduled": ("Process", "Still Scheduled"),
    "again": ("Process", "Re-engaged"),
}

# Canonical pipeline. Order is the funnel order.
#
# The Senior-Director panel is deliberately NOT a stage: only 344 of 1,364
# offers ever went through it, so modelling it linearly would invent a 1,000
# person drop-off that never happened. It is carried as an attribute instead.
STAGES = [
    ("applied", "Applied"),
    ("screened", "Screened"),
    ("phone_screen", "Phone Screen"),
    ("assessment", "Assessment"),
    ("sales_pitch", "Sales Pitch"),
    ("manager_interview", "Manager Interview"),
    ("final_interview", "Final Interview"),
    ("offer", "Offer"),
    ("joined", "Joined"),
]
STAGE_INDEX = {k: i for i, (k, _) in enumerate(STAGES)}

OUTCOMES = ["In Process", "Hired", "Rejected", "Withdrawn", "Dropped Off", "Lapsed"]
OUTCOME_INDEX = {o: i for i, o in enumerate(OUTCOMES)}

# A candidate with no recorded activity for this long, who is not sitting at
# offer stage, is not "in process" — the pipeline has gone cold on them.
STALE_AFTER_DAYS = 45

EXPERIENCE_BANDS = [
    (0.0, 0.01, "Fresh"),
    (0.01, 2.0, "0–2 yrs"),
    (2.0, 4.0, "2–4 yrs"),
    (4.0, 6.0, "4–6 yrs"),
    (6.0, 9.0, "6–9 yrs"),
    (9.0, 1e9, "9+ yrs"),
]

# --------------------------------------------------------------------------
# Scalar cleaners
# --------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def s(v: Any) -> str | None:
    """Normalise any cell to a trimmed single-spaced string, or None."""
    if v is None:
        return None
    if isinstance(v, str):
        t = _WS.sub(" ", unicodedata.normalize("NFKC", v)).strip()
        if not t or t in {"-", "--", "N/A", "n/a", "#N/A", "########"}:
            return None
        return t
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return str(v).strip() or None


def title(v: str | None) -> str | None:
    if not v:
        return None
    small = {"of", "and", "the", "for", "in", "&"}
    parts = v.split(" ")
    out = []
    for i, p in enumerate(parts):
        if p.isupper() and len(p) <= 6:  # keep acronyms
            out.append(p)
        elif i and p.lower() in small:
            out.append(p.lower())
        else:
            out.append(p[:1].upper() + p[1:].lower() if p else p)
    return " ".join(out)


_MONTHS = {
    m.lower(): i + 1
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    )
}
_DATE_TEXT = re.compile(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-/ ]\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{2,4})")


def parse_date(v: Any) -> dt.date | None:
    """Excel gives us datetimes, Excel serials, and hand-typed strings."""
    if isinstance(v, dt.datetime):
        d = v.date()
    elif isinstance(v, dt.date):
        d = v
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        # Excel serial date; anything outside a sane serial range is noise.
        if 40000 <= v <= 50000:
            d = dt.date(1899, 12, 30) + dt.timedelta(days=int(v))
        else:
            return None
    elif isinstance(v, str):
        m = _DATE_TEXT.search(v)
        if not m:
            return None
        day, mon, year = m.group(1), m.group(2)[:3].lower(), m.group(3)
        if mon not in _MONTHS:
            return None
        y = int(year)
        y += 2000 if y < 100 else 0
        try:
            d = dt.date(y, _MONTHS[mon], int(day))
        except ValueError:
            return None
    else:
        return None
    if d < DATE_MIN or d > DATE_MAX:
        return None
    return d


_SALARY = re.compile(r"(\d[\d,]*\.?\d*)\s*(k|lac|lakh)?", re.I)


def parse_salary(v: Any) -> int | None:
    """'50k', '60k base plus incentives', '150,000', 96000, '50-60k' → PKR/month."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = float(v)
    elif isinstance(v, str):
        txt = v.lower().replace(",", "")
        found = _SALARY.findall(txt)
        nums: list[float] = []
        for raw, suffix in found:
            try:
                n = float(raw)
            except ValueError:
                continue
            if suffix in {"lac", "lakh"}:
                n *= 100_000
            elif suffix == "k":
                n *= 1_000
            elif n < 1_000:  # bare "50" in a salary column means 50k
                n *= 1_000
            nums.append(n)
        nums = [n for n in nums if 10_000 <= n <= 2_000_000]
        if not nums:
            return None
        n = sum(nums[:2]) / len(nums[:2])  # "50-60k" → midpoint
    else:
        return None
    if n < 1_000:
        n *= 1_000
    if not (10_000 <= n <= 2_000_000):
        return None
    return int(round(n / 500.0) * 500)


def parse_experience(v: Any) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = float(v)
        return round(n, 1) if 0 <= n <= 45 else None
    if isinstance(v, str):
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*$", v)
        if m:
            n = float(m.group(1))
            return round(n, 1) if 0 <= n <= 45 else None
    return None


_DIGITS = re.compile(r"\D+")


def parse_phone(v: Any) -> str | None:
    """Normalise to Pakistani mobile format 03XXXXXXXXX where plausible."""
    if isinstance(v, float) and not math.isnan(v):
        raw = f"{int(v)}" if v == int(v) else str(v)
    elif isinstance(v, int):
        raw = str(v)
    elif isinstance(v, str):
        raw = v
    else:
        return None
    d = _DIGITS.sub("", raw)
    if not d:
        return None
    if d.startswith("92") and len(d) == 12:
        d = "0" + d[2:]
    elif len(d) == 10 and d.startswith("3"):
        d = "0" + d
    elif len(d) == 11 and d.startswith("03"):
        pass
    else:
        return None
    return d if re.fullmatch(r"03\d{9}", d) else None


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def parse_email(v: Any) -> str | None:
    if isinstance(v, str):
        m = _EMAIL.search(v)
        if m:
            return m.group(0).lower()
    return None


_CNIC = re.compile(r"^\d{5}-\d{7}-\d$")


def parse_cnic(v: Any) -> str | None:
    if isinstance(v, str) and _CNIC.match(v.strip()):
        return v.strip()
    return None


def canon(v: str | None, mapping: dict[str, str], fallback_title: bool = True) -> str | None:
    if not v:
        return None
    key = v.lower().strip()
    if key in mapping:
        return mapping[key]
    return title(v) if fallback_title else v


def classify_reason(v: str | None) -> tuple[str | None, str | None]:
    if not v:
        return None, None
    key = v.lower().strip()
    if key in REASON_TAXONOMY:
        cat, label = REASON_TAXONOMY[key]
        return cat, label
    return "Other", title(v)


def experience_band(exp: float | None) -> str | None:
    if exp is None:
        return None
    for lo, hi, label in EXPERIENCE_BANDS:
        if lo <= exp < hi:
            return label
    return None


def days_between(a: dt.date | None, b: dt.date | None) -> int | None:
    if a is None or b is None:
        return None
    n = (b - a).days
    return n if -5 <= n <= 400 else None


def day_num(d: dt.date | None) -> int:
    return (d - EPOCH).days if d else -1


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def read_rows() -> list[list[Any]]:
    wb = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    rows: list[list[Any]] = []
    header_seen = False
    for r in ws.iter_rows(values_only=True):
        vals = list(r[:NCOL]) + [None] * max(0, NCOL - len(r))
        if not header_seen:
            header_seen = True
            continue
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in vals):
            continue
        rows.append(vals)
    wb.close()
    return rows


POSITIVE_SCREEN = {"eligible"}
POSITIVE_CALL = {"qualified"}
POSITIVE_ASSESS = {"qualified"}
POSITIVE_SP = {"sp+"}
POSITIVE_MGR = {"selected"}
POSITIVE_FINAL = {"selected"}
POSITIVE_OFFER = {"accepted"}

WITHDRAW_TOKENS = {
    "not interested",
    "left without interview",
    "not attended",
    "not appeared",
    "not response",
    "hold by candidate",
}

JOINED_STATUS = {"onboarded", "in-training"}
NO_SHOW_STATUS = {
    "did not join training",
    "did not join after training",
    "required documents not submitted",
    "refused to sign promissory",
}


def build_record(row: list[Any], idx: int) -> dict[str, Any]:
    g = lambda k: row[C[k]]  # noqa: E731

    applied = parse_date(g("applied_date"))
    call_d = parse_date(g("call_date"))
    assess_d = parse_date(g("assessment_date"))
    sp_d = parse_date(g("sp_date"))
    mgr_d = parse_date(g("mgr_interview_date")) or parse_date(g("mgr_interview_start"))
    # The sheet drifted: for ~785 rows the final-interview date landed in the
    # "Final Interviewer" column. Fall back through every final-stage date cell.
    final_d = (
        parse_date(g("final_start"))
        or parse_date(g("final_planned"))
        or parse_date(g("final_interviewer"))
        or parse_date(g("final_end"))
    )
    offer_d = parse_date(g("offer_date"))
    planned_doj = parse_date(g("planned_doj"))
    actual_doj = parse_date(g("actual_doj"))

    # Anchor date: the sheet's Date column, else the first stage date we have.
    anchor = applied or call_d or assess_d or sp_d or mgr_d
    if anchor is None:
        return {}

    screen_status = s(g("screen_status"))
    call_status = s(g("call_status"))
    assess_status = s(g("assessment_status"))
    sp_status = s(g("sp_status"))
    mgr_status = s(g("mgr_interview_status"))
    fin_status = s(g("final_status"))
    offer_status = s(g("offer_status"))
    outcome_status = s(g("outcome_status"))

    low = lambda v: v.lower() if v else None  # noqa: E731

    # ---- stage reach ------------------------------------------------------
    reached = 0  # applied
    if screen_status:
        reached = max(reached, STAGE_INDEX["screened"])
    if call_status or call_d:
        reached = max(reached, STAGE_INDEX["phone_screen"])
    if assess_status or assess_d:
        reached = max(reached, STAGE_INDEX["assessment"])
    if sp_status or sp_d:
        reached = max(reached, STAGE_INDEX["sales_pitch"])
    if mgr_status or mgr_d or s(g("hiring_manager")):
        reached = max(reached, STAGE_INDEX["manager_interview"])
    if fin_status or final_d:
        reached = max(reached, STAGE_INDEX["final_interview"])
    if offer_status or offer_d:
        reached = max(reached, STAGE_INDEX["offer"])
    if actual_doj or low(outcome_status) in JOINED_STATUS:
        reached = max(reached, STAGE_INDEX["joined"])

    # ---- per-stage pass/fail ---------------------------------------------
    def verdict(status: str | None, positives: set[str]) -> int:
        """1 advanced, 0 stopped, -1 unknown/pending."""
        if not status:
            return -1
        t = status.lower()
        if t in positives:
            return 1
        if t in {"pending", "in process", "onhold by interviewer"}:
            return -1
        return 0

    v_screen = verdict(screen_status, POSITIVE_SCREEN)
    v_call = verdict(call_status, POSITIVE_CALL)
    v_assess = verdict(assess_status, POSITIVE_ASSESS)
    v_sp = verdict(sp_status, POSITIVE_SP)
    v_mgr = verdict(mgr_status, POSITIVE_MGR)
    v_fin = verdict(fin_status, POSITIVE_FINAL)
    v_offer = verdict(offer_status, POSITIVE_OFFER)

    # ---- advancement bitmask ---------------------------------------------
    # `stage_reached` says a candidate *entered* a stage; `stage_passed` says
    # they cleared it. The funnel needs both: entered-vs-cleared is where the
    # real drop-off lives.
    passed = 1 << STAGE_INDEX["applied"]
    for key, v in (
        ("screened", v_screen),
        ("phone_screen", v_call),
        ("assessment", v_assess),
        ("sales_pitch", v_sp),
        ("manager_interview", v_mgr),
        ("final_interview", v_fin),
        ("offer", v_offer),
    ):
        if v == 1:
            passed |= 1 << STAGE_INDEX[key]
    if actual_doj or (outcome_status or "").lower() in JOINED_STATUS:
        passed |= 1 << STAGE_INDEX["joined"]

    # ---- last recorded touch ---------------------------------------------
    activity = [
        d
        for d in (anchor, call_d, assess_d, sp_d, mgr_d, final_d, offer_d, actual_doj)
        if d
    ]
    last_activity = max(activity) if activity else anchor

    # ---- outcome ----------------------------------------------------------
    withdrew = any(
        low(x) in WITHDRAW_TOKENS
        for x in (sp_status, mgr_status, fin_status, outcome_status)
        if x
    )
    joined = bool(actual_doj) or low(outcome_status) in JOINED_STATUS
    no_show = low(outcome_status) in NO_SHOW_STATUS

    if joined:
        outcome = "Hired"
    elif no_show:
        outcome = "Dropped Off"
    elif withdrew or low(offer_status) == "rejected":
        outcome = "Withdrawn"
    elif 0 in (v_screen, v_call, v_assess, v_sp, v_mgr, v_fin):
        outcome = "Rejected"
    else:
        outcome = "In Process"

    # The stage at which an unsuccessful candidate exited.
    exit_stage = None
    if outcome != "In Process":
        for key, v in (
            ("screened", v_screen),
            ("phone_screen", v_call),
            ("assessment", v_assess),
            ("sales_pitch", v_sp),
            ("manager_interview", v_mgr),
            ("final_interview", v_fin),
            ("offer", v_offer),
        ):
            if v == 0:
                exit_stage = key
                break
        if exit_stage is None and outcome in {"Withdrawn", "Dropped Off"}:
            exit_stage = STAGES[reached][0]

    # ---- reasons ----------------------------------------------------------
    sc_cat, sc_label = classify_reason(s(g("screen_reason")))
    cl_cat, cl_label = classify_reason(s(g("call_reason")))
    of_cat, of_label = classify_reason(s(g("offer_reason")))

    loss_cat, loss_label = None, None
    for cat, label in ((of_cat, of_label), (cl_cat, cl_label), (sc_cat, sc_label)):
        if cat:
            loss_cat, loss_label = cat, label
            break
    if loss_cat is None and no_show:
        loss_cat, loss_label = "Onboarding", "No-Show After Offer"
    if loss_cat is None and withdrew:
        loss_cat, loss_label = "Motivation", "Disengaged"

    exp = parse_experience(g("experience"))
    industry = title(s(g("industry")))
    if industry and industry.lower() == "fresh":
        exp = 0.0 if exp is None else exp

    rec = {
        "id": idx,
        "name": title(s(g("name"))) or "Unknown Candidate",
        "phone": parse_phone(g("phone")),
        "email": parse_email(g("email")),
        "cnic": parse_cnic(g("cnic")),
        "city": title(s(g("city"))) or "Lahore",
        "source": canon(s(g("source")), SOURCE_MAP),
        "reference": s(g("reference")),
        "applied_role": canon(s(g("applied_role")), ROLE_MAP),
        "drive": "Project Drive" if (s(g("drive")) or "").lower() == "project drive" else "BAU",
        "industry": industry,
        "experience_years": exp,
        "experience_band": experience_band(exp),
        "degree": canon(s(g("degree")), DEGREE_MAP),
        "institute": canon(s(g("institute")), INSTITUTE_MAP),
        "current_salary": parse_salary(g("current_salary")),
        "recruiter": title(s(g("recruiter"))),
        "hiring_manager": title(s(g("hiring_manager"))),
        "final_interviewer": title(s(g("final_interviewer"))),
        "director": title(s(g("director"))),
        "team": title(s(g("team"))),
        "hired_role": canon(s(g("hired_role")), HIRED_ROLE_MAP),
        "screen_status": title(screen_status),
        "call_status": title(call_status),
        "assessment_status": title(assess_status),
        "sp_status": sp_status,
        "manager_status": title(mgr_status),
        "final_status": title(fin_status),
        "offer_status": title(offer_status),
        "outcome_status": title(outcome_status),
        "applied_date": anchor,
        "call_date": call_d,
        "assessment_date": assess_d,
        "sp_date": sp_d,
        "manager_date": mgr_d,
        "final_date": final_d,
        "offer_date": offer_d,
        "planned_doj": planned_doj,
        "actual_doj": actual_doj,
        "last_activity": last_activity,
        "stage_reached": reached,
        "stage_passed": passed,
        "outcome": outcome,
        "exit_stage": exit_stage,
        "screen_reason_cat": sc_cat,
        "screen_reason": sc_label,
        "call_reason_cat": cl_cat,
        "call_reason": cl_label,
        "offer_reason_cat": of_cat,
        "offer_reason": of_label,
        "loss_category": loss_cat,
        "loss_reason": loss_label,
        "remarks": s(g("screen_remarks")) or s(g("remarks")),
        # ---- durations ----
        "d_to_call": days_between(anchor, call_d),
        "d_call_to_assessment": days_between(call_d, assess_d),
        "d_assessment_to_sp": days_between(assess_d, sp_d),
        "d_sp_to_manager": days_between(sp_d, mgr_d),
        "d_manager_to_final": days_between(mgr_d, final_d),
        "d_final_to_offer": days_between(final_d, offer_d),
        "d_offer_to_join": days_between(offer_d, actual_doj),
        "time_to_hire": days_between(anchor, actual_doj),
        "time_to_offer": days_between(anchor, offer_d),
        "doj_slip": days_between(planned_doj, actual_doj),
    }
    return rec


# --------------------------------------------------------------------------
# Columnar encoding for the browser store
# --------------------------------------------------------------------------

DICT_FIELDS = [
    "source",
    "channel",
    "recruiter",
    "applied_role",
    "hired_role",
    "industry",
    "degree",
    "institute",
    "city",
    "team",
    "hiring_manager",
    "final_interviewer",
    "director",
    "drive",
    "experience_band",
    "screen_status",
    "call_status",
    "assessment_status",
    "sp_status",
    "manager_status",
    "final_status",
    "offer_status",
    "outcome_status",
    "loss_category",
    "loss_reason",
    "exit_stage",
    "salary_band",
]

DATE_FIELDS = [
    "applied_date",
    "call_date",
    "assessment_date",
    "sp_date",
    "manager_date",
    "final_date",
    "offer_date",
    "planned_doj",
    "actual_doj",
    "last_activity",
]

NUM_FIELDS = [
    "experience_years",
    "current_salary",
    "d_to_call",
    "d_call_to_assessment",
    "d_assessment_to_sp",
    "d_sp_to_manager",
    "d_manager_to_final",
    "d_final_to_offer",
    "d_offer_to_join",
    "time_to_hire",
    "time_to_offer",
    "doj_slip",
]

SALARY_BANDS = [
    (0, 40_000, "< 40k"),
    (40_000, 60_000, "40–60k"),
    (60_000, 80_000, "60–80k"),
    (80_000, 100_000, "80–100k"),
    (100_000, 150_000, "100–150k"),
    (150_000, 10**9, "150k+"),
]


def salary_band(v: int | None) -> str | None:
    if v is None:
        return None
    for lo, hi, label in SALARY_BANDS:
        if lo <= v < hi:
            return label
    return None


def encode_column(values: list[int], null_value: int) -> Any:
    """Dense list, or a sparse {n, i, v} payload when mostly null.

    Roughly two thirds of the operational columns only apply to candidates who
    got deep into the funnel (offer dates, teams, directors, stage durations),
    so they are >90% null. Sparse-encoding those cuts the wire payload by ~4x
    while the loader still expands everything to dense typed arrays.
    """
    n = len(values)
    nulls = sum(1 for v in values if v == null_value)
    if n and nulls / n > 0.7:
        idx: list[int] = []
        vals: list[int] = []
        for i, v in enumerate(values):
            if v != null_value:
                idx.append(i)
                vals.append(v)
        # Delta-encode indices — they are ascending, so deltas are small.
        deltas = [idx[0]] if idx else []
        for a, b in zip(idx, idx[1:]):
            deltas.append(b - a)
        return {"s": 1, "i": deltas, "v": vals}
    return values


def main() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(WEB_DATA_DIR, exist_ok=True)

    raw = read_rows()
    records: list[dict[str, Any]] = []
    for i, row in enumerate(raw):
        rec = build_record(row, len(records))
        if rec:
            records.append(rec)

    # ---- derived cross-record fields -------------------------------------
    for r in records:
        r["channel"] = SOURCE_CHANNEL.get(r["source"] or "", None)
        r["salary_band"] = salary_band(r["current_salary"])

    # ---- pipeline staleness ----------------------------------------------
    # "In Process" is only meaningful relative to the dataset's own horizon.
    horizon = max(r["last_activity"] for r in records if r["last_activity"])
    for r in records:
        if r["outcome"] != "In Process":
            continue
        idle = (horizon - r["last_activity"]).days if r["last_activity"] else 999
        r["days_idle"] = idle
        if idle > STALE_AFTER_DAYS and r["stage_reached"] < STAGE_INDEX["offer"]:
            r["outcome"] = "Lapsed"
            if not r["loss_category"]:
                r["loss_category"] = "Contactability"
                r["loss_reason"] = "Went Cold"
    for r in records:
        r.setdefault("days_idle", None)

    # Repeat-applicant detection (phone first, then name+institute fingerprint).
    seen: dict[str, list[int]] = defaultdict(list)
    for r in records:
        key = r["phone"] or f"n:{(r['name'] or '').lower()}"
        seen[key].append(r["id"])
    for key, ids in seen.items():
        ids.sort(key=lambda i: records[i]["applied_date"] or DATE_MIN)
        for n, i in enumerate(ids):
            records[i]["application_seq"] = n + 1
            records[i]["is_repeat"] = n > 0
            records[i]["candidate_key"] = key

    # ---- JSONL (backend seed) --------------------------------------------
    jsonl_path = os.path.join(DATA_DIR, "canonical.jsonl")
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for r in records:
            out = {
                k: (v.isoformat() if isinstance(v, dt.date) else v) for k, v in r.items()
            }
            f.write(json.dumps(out, ensure_ascii=False) + "\n")

    # ---- Columnar store (browser) ----------------------------------------
    dicts: dict[str, list[str]] = {}
    raw_cols: dict[str, list[int]] = {}
    nulls: dict[str, int] = {}

    for field in DICT_FIELDS:
        counts = Counter(r.get(field) for r in records if r.get(field))
        values = [v for v, _ in counts.most_common()]
        dicts[field] = values
        lookup = {v: i for i, v in enumerate(values)}
        raw_cols[field] = [lookup.get(r.get(field), -1) for r in records]
        nulls[field] = -1

    for field in DATE_FIELDS:
        raw_cols[field] = [day_num(r.get(field)) for r in records]
        nulls[field] = -1

    NULL_NUM = -32768
    for field in NUM_FIELDS:
        if field == "experience_years":
            raw_cols[field] = [
                int(round(r[field] * 10)) if r.get(field) is not None else NULL_NUM
                for r in records
            ]
        elif field == "current_salary":
            raw_cols[field] = [
                int(r[field] // 500) if r.get(field) is not None else NULL_NUM for r in records
            ]
        else:
            raw_cols[field] = [
                r[field] if r.get(field) is not None else NULL_NUM for r in records
            ]
        nulls[field] = NULL_NUM

    raw_cols["stage_reached"] = [r["stage_reached"] for r in records]
    raw_cols["stage_passed"] = [r["stage_passed"] for r in records]
    raw_cols["outcome"] = [OUTCOME_INDEX[r["outcome"]] for r in records]
    raw_cols["is_repeat"] = [1 if r.get("is_repeat") else 0 for r in records]
    raw_cols["days_idle"] = [
        r["days_idle"] if r.get("days_idle") is not None else NULL_NUM for r in records
    ]
    for k in ("stage_reached", "stage_passed", "outcome", "is_repeat"):
        nulls[k] = -1
    nulls["days_idle"] = NULL_NUM

    cols = {k: encode_column(v, nulls[k]) for k, v in raw_cols.items()}

    store = {
        "meta": {
            "generatedAt": dt.datetime.now().replace(microsecond=0).isoformat(),
            "source": os.path.basename(SOURCE),
            "rowCount": len(records),
            "epoch": EPOCH.isoformat(),
            "dateMin": min(day_num(r["applied_date"]) for r in records),
            "dateMax": max(day_num(r["applied_date"]) for r in records),
            "horizon": day_num(horizon),
            "stages": [{"key": k, "label": l} for k, l in STAGES],
            "outcomes": OUTCOMES,
            "experienceBands": [b[2] for b in EXPERIENCE_BANDS],
            "salaryBands": [b[2] for b in SALARY_BANDS],
            "salaryUnit": 500,
            "experienceUnit": 0.1,
            "nullNum": NULL_NUM,
            "staleAfterDays": STALE_AFTER_DAYS,
            "nulls": nulls,
        },
        "dicts": dicts,
        "cols": cols,
        "names": [r["name"] for r in records],
        "phones": [r["phone"] or "" for r in records],
    }

    payload = json.dumps(store, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    # Ship gzip bytes under a neutral extension so no dev/CDN layer tries to
    # transparently re-decode them; the client inflates via DecompressionStream.
    import gzip

    gz_path = os.path.join(WEB_DATA_DIR, "store.gz")
    with open(gz_path, "wb") as f:
        f.write(gzip.compress(payload, 9))

    # Uncompressed twin for the Node/SSR path and for debugging.
    store_path = os.path.join(WEB_DATA_DIR, "store.json")
    with open(store_path, "wb") as f:
        f.write(payload)

    # ---- console summary --------------------------------------------------
    print(f"records          : {len(records):,}")
    print(f"canonical.jsonl  : {os.path.getsize(jsonl_path)/1e6:.2f} MB")
    print(f"store.json       : {len(payload)/1e6:.2f} MB")
    print(f"store.gz         : {os.path.getsize(gz_path)/1e6:.2f} MB  <- wire payload")
    sparse = [k for k, v in cols.items() if isinstance(v, dict)]
    print(f"sparse columns   : {len(sparse)}/{len(cols)}")
    print()
    print(f"{'Stage':<22}{'Entered':>10}{'Cleared':>10}{'Pass %':>9}")
    for i, (key, label) in enumerate(STAGES):
        entered = sum(1 for r in records if r["stage_reached"] >= i)
        cleared = sum(1 for r in records if r["stage_passed"] >> i & 1)
        pct = f"{cleared/entered*100:.1f}%" if entered else "—"
        print(f"{label:<22}{entered:>10,}{cleared:>10,}{pct:>9}")
    print()
    print("Outcomes:", dict(Counter(r["outcome"] for r in records)))
    print("Recruiters:", len(dicts["recruiter"]), dicts["recruiter"][:6], "...")
    print("Sources:", dicts["source"])
    print("Hiring managers:", len(dicts["hiring_manager"]))
    print("Institutes:", len(dicts["institute"]), "| Industries:", len(dicts["industry"]))
    print("Loss categories:", dicts["loss_category"])
    hires = [r for r in records if r["outcome"] == "Hired"]
    tth = sorted(r["time_to_hire"] for r in hires if r["time_to_hire"] is not None)
    if tth:
        q = lambda p: tth[min(len(tth) - 1, int(len(tth) * p))]  # noqa: E731
        print(
            f"Hires: {len(hires):,}  time-to-hire p25/p50/p75/p90: "
            f"{q(.25)}/{q(.5)}/{q(.75)}/{q(.9)} days"
        )
    repeats = sum(1 for r in records if r.get("is_repeat"))
    print(f"Repeat applications: {repeats:,} ({repeats/len(records)*100:.1f}%)")


if __name__ == "__main__":
    main()
