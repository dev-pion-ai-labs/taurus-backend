-- Add executive-briefing framing and ranged-value columns to transformation_reports.
-- Legacy columns (overall_score, total_ai_value, recommendations, etc.) remain for
-- backward-compatible frontend rendering while the new briefing shape (executive_brief,
-- decision_blocks, assumptions_and_limits, peer_context) rolls out.

ALTER TABLE "transformation_reports" ADD COLUMN "company_type" TEXT;
ALTER TABLE "transformation_reports" ADD COLUMN "primary_audience" TEXT;
ALTER TABLE "transformation_reports" ADD COLUMN "report_goal" TEXT;
ALTER TABLE "transformation_reports" ADD COLUMN "thesis" TEXT;
ALTER TABLE "transformation_reports" ADD COLUMN "big_move" TEXT;

ALTER TABLE "transformation_reports" ADD COLUMN "total_ai_value_low" DOUBLE PRECISION;
ALTER TABLE "transformation_reports" ADD COLUMN "total_ai_value_high" DOUBLE PRECISION;
ALTER TABLE "transformation_reports" ADD COLUMN "fte_redeployable_band" TEXT;
ALTER TABLE "transformation_reports" ADD COLUMN "confidence_note" TEXT;

ALTER TABLE "transformation_reports" ADD COLUMN "executive_brief" JSONB;
ALTER TABLE "transformation_reports" ADD COLUMN "decision_blocks" JSONB;
ALTER TABLE "transformation_reports" ADD COLUMN "assumptions_and_limits" JSONB;
ALTER TABLE "transformation_reports" ADD COLUMN "peer_context" JSONB;
