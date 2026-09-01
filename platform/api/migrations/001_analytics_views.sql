-- =============================================================================
-- CPML Recruitment Command Center — analytics views
--
-- The application tables are created from the SQLAlchemy models; this file
-- adds the derived objects the dashboard depends on. Each view answers one
-- question the UI asks on nearly every page, so the cost of the aggregate is
-- paid once per sync instead of once per page load.
--
-- Every view is refreshed CONCURRENTLY by the Celery worker, which requires a
-- unique index on each — hence the explicit unique indexes below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Stage bit positions, matching Stage in app/models/recruitment.py.
-- Kept as an immutable function so the bitmask logic lives in exactly one
-- place rather than being re-derived in every view.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stage_bit(stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE stage
    WHEN 'applied'            THEN 1
    WHEN 'screened'           THEN 2
    WHEN 'phone_screen'       THEN 4
    WHEN 'assessment'         THEN 8
    WHEN 'sales_pitch'        THEN 16
    WHEN 'manager_interview'  THEN 32
    WHEN 'final_interview'    THEN 64
    WHEN 'offer'              THEN 128
    WHEN 'joined'             THEN 256
  END;
$$;

CREATE OR REPLACE FUNCTION stage_rank(stage text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE stage
    WHEN 'applied'            THEN 0
    WHEN 'screened'           THEN 1
    WHEN 'phone_screen'       THEN 2
    WHEN 'assessment'         THEN 3
    WHEN 'sales_pitch'        THEN 4
    WHEN 'manager_interview'  THEN 5
    WHEN 'final_interview'    THEN 6
    WHEN 'offer'              THEN 7
    WHEN 'joined'             THEN 8
  END::smallint;
$$;


-- -----------------------------------------------------------------------------
-- Daily funnel — the base grain everything time-based rolls up from.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_daily_funnel CASCADE;
CREATE MATERIALIZED VIEW mv_daily_funnel AS
SELECT
    a.applied_on                                                    AS day,
    COUNT(*)                                                        AS applications,
    COUNT(DISTINCT a.candidate_id)                                  AS candidates,
    COUNT(*) FILTER (WHERE a.is_repeat)                             AS repeat_applications,

    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 2)  AS contacted,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 4)  AS pitched,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 5)  AS manager_interviews,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 6)  AS final_interviews,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 7)  AS offers,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 8)  AS joined,

    COUNT(*) FILTER (WHERE a.stage_passed_mask & stage_bit('phone_screen') > 0)      AS phone_qualified,
    COUNT(*) FILTER (WHERE a.stage_passed_mask & stage_bit('sales_pitch') > 0)       AS pitch_passed,
    COUNT(*) FILTER (WHERE a.stage_passed_mask & stage_bit('manager_interview') > 0) AS manager_selected,
    COUNT(*) FILTER (WHERE a.stage_passed_mask & stage_bit('offer') > 0)             AS offers_accepted,

    COUNT(*) FILTER (WHERE a.outcome = 'HIRED')       AS hired,
    COUNT(*) FILTER (WHERE a.outcome = 'IN_PROCESS')  AS in_process,
    COUNT(*) FILTER (WHERE a.outcome = 'REJECTED')    AS rejected,
    COUNT(*) FILTER (WHERE a.outcome = 'WITHDRAWN')   AS withdrawn,
    COUNT(*) FILTER (WHERE a.outcome = 'DROPPED_OFF') AS dropped_off,
    COUNT(*) FILTER (WHERE a.outcome = 'LAPSED')      AS lapsed,

    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.time_to_hire)  AS time_to_hire_median,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.time_to_offer) AS time_to_offer_median,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.days_to_call)  AS days_to_call_median
FROM applications a
GROUP BY a.applied_on;

CREATE UNIQUE INDEX ux_mv_daily_funnel_day ON mv_daily_funnel (day);


-- -----------------------------------------------------------------------------
-- Recruiter performance, monthly.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_recruiter_performance CASCADE;
CREATE MATERIALIZED VIEW mv_recruiter_performance AS
SELECT
    r.id                                    AS recruiter_id,
    r.name                                  AS recruiter,
    DATE_TRUNC('month', a.applied_on)::date AS month,
    COUNT(*)                                AS applications,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 2) AS contacted,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 4) AS pitched,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 7) AS offers,
    COUNT(*) FILTER (WHERE a.outcome = 'HIRED')                    AS hired,
    COUNT(*) FILTER (WHERE a.outcome = 'LAPSED')                   AS lapsed,
    COUNT(*) FILTER (WHERE a.stage_passed_mask & stage_bit('sales_pitch') > 0) AS pitch_passed,

    ROUND(
        100.0 * COUNT(*) FILTER (WHERE a.outcome = 'HIRED') / NULLIF(COUNT(*), 0),
        4
    ) AS conversion_pct,

    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.days_to_call) AS days_to_call_median,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY a.time_to_hire) AS time_to_hire_median
FROM applications a
JOIN recruiters r ON r.id = a.recruiter_id
GROUP BY r.id, r.name, DATE_TRUNC('month', a.applied_on);

CREATE UNIQUE INDEX ux_mv_recruiter_perf ON mv_recruiter_performance (recruiter_id, month);
CREATE INDEX ix_mv_recruiter_perf_month ON mv_recruiter_performance (month);


-- -----------------------------------------------------------------------------
-- Source performance, monthly.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_source_performance CASCADE;
CREATE MATERIALIZED VIEW mv_source_performance AS
SELECT
    s.id                                    AS source_id,
    s.name                                  AS source,
    s.channel                               AS channel,
    DATE_TRUNC('month', a.applied_on)::date AS month,
    COUNT(*)                                AS applications,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 4) AS pitched,
    COUNT(*) FILTER (WHERE stage_rank(a.stage_reached::text) >= 7) AS offers,
    COUNT(*) FILTER (WHERE a.outcome = 'HIRED')                    AS hired,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE a.outcome = 'HIRED') / NULLIF(COUNT(*), 0),
        4
    ) AS conversion_pct,
    -- Null until finance supplies per-source cost; the expression is here so
    -- cost-per-hire lights up the moment it does.
    ROUND(s.monthly_cost / NULLIF(COUNT(*) FILTER (WHERE a.outcome = 'HIRED'), 0), 2)
        AS cost_per_hire
FROM applications a
JOIN sources s ON s.id = a.source_id
GROUP BY s.id, s.name, s.channel, s.monthly_cost, DATE_TRUNC('month', a.applied_on);

CREATE UNIQUE INDEX ux_mv_source_perf ON mv_source_performance (source_id, month);


-- -----------------------------------------------------------------------------
-- Stage durations — the percentile spread for every hand-off.
-- The p90 is the operationally useful number: medians here are frequently
-- zero because most hand-offs happen same-day, and a zero median hides a
-- three-week tail entirely.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_stage_durations CASCADE;
CREATE MATERIALIZED VIEW mv_stage_durations AS
WITH handoffs AS (
    SELECT 'application_to_call'   AS handoff, days_to_call             AS days, applied_on FROM applications
    UNION ALL
    SELECT 'call_to_assessment',   days_call_to_assessment,  applied_on FROM applications
    UNION ALL
    SELECT 'assessment_to_pitch',  days_assessment_to_pitch, applied_on FROM applications
    UNION ALL
    SELECT 'pitch_to_manager',     days_pitch_to_manager,    applied_on FROM applications
    UNION ALL
    SELECT 'manager_to_final',     days_manager_to_final,    applied_on FROM applications
    UNION ALL
    SELECT 'final_to_offer',       days_final_to_offer,      applied_on FROM applications
    UNION ALL
    SELECT 'offer_to_join',        days_offer_to_join,       applied_on FROM applications
)
SELECT
    handoff,
    DATE_TRUNC('month', applied_on)::date                   AS month,
    COUNT(*) FILTER (WHERE days IS NOT NULL)                AS measured,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY days)      AS p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY days)      AS median,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days)      AS p75,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY days)      AS p90,
    MAX(days)                                               AS max_days,
    COUNT(*) FILTER (WHERE days = 0)                        AS same_day,
    COUNT(*) FILTER (WHERE days > 14)                       AS over_two_weeks
FROM handoffs
GROUP BY handoff, DATE_TRUNC('month', applied_on);

CREATE UNIQUE INDEX ux_mv_stage_durations ON mv_stage_durations (handoff, month);


-- -----------------------------------------------------------------------------
-- Supporting indexes for the interactive (non-materialised) paths.
-- -----------------------------------------------------------------------------

-- Partial index over the live pipeline only: the aging queries never touch
-- closed applications, and this keeps the index a fraction of the table size.
CREATE INDEX IF NOT EXISTS ix_app_live_aging
    ON applications (days_idle DESC, stage_reached)
    WHERE outcome IN ('IN_PROCESS', 'LAPSED');

-- Loss analysis always excludes inferred reasons, so index only the recorded ones.
CREATE INDEX IF NOT EXISTS ix_app_recorded_loss
    ON applications (loss_category, exit_stage)
    WHERE loss_inferred = false AND loss_category IS NOT NULL;

-- Trigram index for candidate name search in the explorer.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS ix_candidate_name_trgm
    ON candidates USING gin (lower(full_name) gin_trgm_ops);
