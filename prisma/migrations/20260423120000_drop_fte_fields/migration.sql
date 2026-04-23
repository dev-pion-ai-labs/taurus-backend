-- Drop FTE columns from transformation_reports.
-- The FTE band was a vibes-based pick with no underlying calculation; removed entirely.

ALTER TABLE "transformation_reports" DROP COLUMN IF EXISTS "fte_redeployable";
ALTER TABLE "transformation_reports" DROP COLUMN IF EXISTS "fte_redeployable_band";
