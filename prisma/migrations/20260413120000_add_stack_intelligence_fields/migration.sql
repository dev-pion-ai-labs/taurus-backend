-- AlterTable
ALTER TABLE "tool_entries" ADD COLUMN "utilization_percent" INTEGER,
ADD COLUMN "contract_start_date" TIMESTAMP(3),
ADD COLUMN "contract_end_date" TIMESTAMP(3),
ADD COLUMN "renewal_alert_days" INTEGER DEFAULT 30;

-- CreateTable
CREATE TABLE "tool_spend_records" (
    "id" TEXT NOT NULL,
    "tool_entry_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_spend_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tool_spend_records_tool_entry_id_month_key" ON "tool_spend_records"("tool_entry_id", "month");

-- CreateIndex
CREATE INDEX "tool_spend_records_organization_id_month_idx" ON "tool_spend_records"("organization_id", "month");

-- AddForeignKey
ALTER TABLE "tool_spend_records" ADD CONSTRAINT "tool_spend_records_tool_entry_id_fkey" FOREIGN KEY ("tool_entry_id") REFERENCES "tool_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_spend_records" ADD CONSTRAINT "tool_spend_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
