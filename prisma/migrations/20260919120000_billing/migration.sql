ALTER TABLE "Conversion" ADD COLUMN "orderId" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "orderName" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "orderStatus" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "acceptedAt" DATETIME;
CREATE TABLE "BillingRequest" (
 "id" TEXT NOT NULL PRIMARY KEY, "quoteId" INTEGER NOT NULL, "kind" TEXT NOT NULL,
 "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'EUR',
 "status" TEXT NOT NULL DEFAULT 'queued', "invoiceId" INTEGER, "invoiceNumber" TEXT,
 "invoiceState" TEXT, "paymentState" TEXT, "residual" INTEGER, "error" TEXT,
 "syncedAt" DATETIME, "updatedAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BillingRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BillingRequest_quoteId_kind_key" ON "BillingRequest"("quoteId", "kind");
CREATE INDEX "BillingRequest_status_updatedAt_idx" ON "BillingRequest"("status", "updatedAt");
