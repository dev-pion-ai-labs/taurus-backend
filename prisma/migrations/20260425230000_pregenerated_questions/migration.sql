-- Cache starter consultation questions on Department + Workflow so users
-- starting a scoped consultation don't have to wait for AI generation.
-- Purely additive — both columns nullable, no defaults required.

ALTER TABLE "departments"
  ADD COLUMN "pre_generated_questions" JSONB,
  ADD COLUMN "pre_generated_at" TIMESTAMP(3);

ALTER TABLE "workflows"
  ADD COLUMN "pre_generated_questions" JSONB,
  ADD COLUMN "pre_generated_at" TIMESTAMP(3);
