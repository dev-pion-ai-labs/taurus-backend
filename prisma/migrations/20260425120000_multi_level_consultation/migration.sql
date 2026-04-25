-- Add scope (ORG/DEPARTMENT/WORKFLOW), departmentId, workflowId to consultation_sessions.
-- Existing rows default to ORG. Departments and workflows gain reverse relations.
-- Backward compatible — all new fields nullable or defaulted.

CREATE TYPE "ConsultationScope" AS ENUM ('ORG', 'DEPARTMENT', 'WORKFLOW');

ALTER TABLE "consultation_sessions"
  ADD COLUMN "scope" "ConsultationScope" NOT NULL DEFAULT 'ORG',
  ADD COLUMN "department_id" TEXT,
  ADD COLUMN "workflow_id" TEXT;

ALTER TABLE "consultation_sessions"
  ADD CONSTRAINT "consultation_sessions_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "consultation_sessions"
  ADD CONSTRAINT "consultation_sessions_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "consultation_sessions_organization_id_scope_idx"
  ON "consultation_sessions"("organization_id", "scope");

CREATE INDEX "consultation_sessions_department_id_idx"
  ON "consultation_sessions"("department_id");

CREATE INDEX "consultation_sessions_workflow_id_idx"
  ON "consultation_sessions"("workflow_id");
