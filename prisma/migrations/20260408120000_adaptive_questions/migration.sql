-- AlterEnum
ALTER TYPE "QuestionSection" ADD VALUE 'PERSONALIZED';
ALTER TYPE "QuestionSection" ADD VALUE 'ADAPTIVE';

-- AlterTable: make question_id optional and add adaptive fields
ALTER TABLE "session_questions" ALTER COLUMN "question_id" DROP NOT NULL;

ALTER TABLE "session_questions" ADD COLUMN "is_adaptive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "session_questions" ADD COLUMN "adaptive_text" TEXT;
ALTER TABLE "session_questions" ADD COLUMN "adaptive_type" TEXT;
ALTER TABLE "session_questions" ADD COLUMN "adaptive_options" JSONB;
