-- One-shot data migration. Clears pre-generated starter questions on every
-- existing department and workflow so the next consultation start triggers a
-- live cache-miss generation at the NEW per-scope batch size (13-15 for
-- department, 11-13 for workflow). New entities created from now on get the
-- updated 3-question pregen via the queue processor.
--
-- Idempotent: the WHERE clauses make a re-run a no-op once caches have been
-- repopulated by the queue.

UPDATE "departments"
  SET "pre_generated_questions" = NULL,
      "pre_generated_at" = NULL
  WHERE "pre_generated_questions" IS NOT NULL
     OR "pre_generated_at" IS NOT NULL;

UPDATE "workflows"
  SET "pre_generated_questions" = NULL,
      "pre_generated_at" = NULL
  WHERE "pre_generated_questions" IS NOT NULL
     OR "pre_generated_at" IS NOT NULL;
