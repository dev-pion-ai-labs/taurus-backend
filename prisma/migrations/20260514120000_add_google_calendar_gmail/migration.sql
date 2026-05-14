-- Add GOOGLE_CALENDAR and GMAIL to IntegrationProvider enum
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_CALENDAR';
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'GMAIL';
