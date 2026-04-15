-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('BACKLOG', 'THIS_SPRINT', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'DEPLOYED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EstimatedEffort" AS ENUM ('HOURS', 'DAYS', 'WEEKS', 'MONTHS');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "transformation_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_id" TEXT,
    "source_recommendation_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "department" TEXT,
    "category" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'BACKLOG',
    "assignee_id" TEXT,
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "estimated_value" DOUBLE PRECISION,
    "actual_value" DOUBLE PRECISION,
    "estimated_effort" "EstimatedEffort",
    "phase" INTEGER,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "due_date" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "deployed_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "blocker_note" TEXT,
    "sprint_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "goal" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_comments" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transformation_actions_organization_id_status_idx" ON "transformation_actions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "transformation_actions_sprint_id_idx" ON "transformation_actions"("sprint_id");

-- CreateIndex
CREATE INDEX "sprints_organization_id_idx" ON "sprints"("organization_id");

-- CreateIndex
CREATE INDEX "action_comments_action_id_idx" ON "action_comments"("action_id");

-- AddForeignKey
ALTER TABLE "transformation_actions" ADD CONSTRAINT "transformation_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_actions" ADD CONSTRAINT "transformation_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consultation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_actions" ADD CONSTRAINT "transformation_actions_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_actions" ADD CONSTRAINT "transformation_actions_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "transformation_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
