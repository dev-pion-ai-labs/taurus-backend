-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('BASE', 'INDUSTRY');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('GENERATING', 'ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING_TEMPLATE', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QuestionSection" AS ENUM ('BASE', 'INDUSTRY', 'CHALLENGE_BONUS');

-- CreateTable
CREATE TABLE "industries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry_id" TEXT NOT NULL,
    "size" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_templates" (
    "id" TEXT NOT NULL,
    "type" "TemplateType" NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "industry_id" TEXT,
    "ai_model" TEXT,
    "ai_prompt_hash" TEXT,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_questions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" "QuestionType" NOT NULL,
    "options" JSONB,
    "order_index" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_challenge_areas" (
    "question_id" TEXT NOT NULL,
    "challenge_area_id" TEXT NOT NULL,

    CONSTRAINT "question_challenge_areas_pkey" PRIMARY KEY ("question_id","challenge_area_id")
);

-- CreateTable
CREATE TABLE "consultation_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING_TEMPLATE',
    "base_template_id" TEXT NOT NULL,
    "industry_template_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_questions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "section" "QuestionSection" NOT NULL,
    "order_index" INTEGER NOT NULL,
    "answer" JSONB,
    "answered_at" TIMESTAMP(3),
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "industries_normalized_key_key" ON "industries"("normalized_key");

-- CreateIndex
CREATE INDEX "organizations_industry_id_idx" ON "organizations"("industry_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "otp_codes_user_id_idx" ON "otp_codes"("user_id");

-- CreateIndex
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_templates_type_industry_id_version_key" ON "consultation_templates"("type", "industry_id", "version");

-- CreateIndex
CREATE INDEX "template_questions_template_id_order_index_idx" ON "template_questions"("template_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_areas_normalized_key_key" ON "challenge_areas"("normalized_key");

-- CreateIndex
CREATE INDEX "consultation_sessions_organization_id_idx" ON "consultation_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "consultation_sessions_status_idx" ON "consultation_sessions"("status");

-- CreateIndex
CREATE INDEX "session_questions_session_id_order_index_idx" ON "session_questions"("session_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "session_questions_session_id_question_id_key" ON "session_questions"("session_id", "question_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_templates" ADD CONSTRAINT "consultation_templates_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "consultation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_challenge_areas" ADD CONSTRAINT "question_challenge_areas_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "template_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_challenge_areas" ADD CONSTRAINT "question_challenge_areas_challenge_area_id_fkey" FOREIGN KEY ("challenge_area_id") REFERENCES "challenge_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_base_template_id_fkey" FOREIGN KEY ("base_template_id") REFERENCES "consultation_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_sessions" ADD CONSTRAINT "consultation_sessions_industry_template_id_fkey" FOREIGN KEY ("industry_template_id") REFERENCES "consultation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "consultation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "template_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
