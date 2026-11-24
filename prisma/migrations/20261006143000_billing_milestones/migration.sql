ALTER TABLE "BillingRequest" ADD COLUMN "netAmount" INTEGER;
ALTER TABLE "BillingRequest" ADD COLUMN "taxAmount" INTEGER;
ALTER TABLE "BillingRequest" ADD COLUMN "partnerId" INTEGER;
ALTER TABLE "BillingRequest" ADD COLUMN "authorizedBy" TEXT;
ALTER TABLE "BillingRequest" ADD COLUMN "authorizedAt" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE "BillingRequest" ADD COLUMN "milestoneConfirmedAt" DATETIME;
