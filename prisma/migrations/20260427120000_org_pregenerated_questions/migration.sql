-- Cache starter consultation questions on Organization for the NEXT org
-- follow-up consultation. Populated by a background job chained after the
-- prior session's report generation finishes. Purely additive — both
-- columns nullable, no defaults required.

ALTER TABLE "organizations"
  ADD COLUMN "pre_generated_questions" JSONB,
  ADD COLUMN "pre_generated_at" TIMESTAMP(3);
