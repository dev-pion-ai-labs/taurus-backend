-- Add top-of-report snapshot column — a compact, scannable summary designed
-- to be read in ~5 seconds before the reader dives into the full briefing.

ALTER TABLE "transformation_reports" ADD COLUMN "snapshot" JSONB;
