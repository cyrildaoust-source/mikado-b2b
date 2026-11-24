ALTER TABLE "Quote" ADD COLUMN "number" TEXT;
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");
ALTER TABLE "Revision" ADD COLUMN "publishedNumber" INTEGER;
ALTER TABLE "Revision" ADD COLUMN "issuedAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "sentAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "calculation" TEXT;
CREATE UNIQUE INDEX "Revision_quoteId_publishedNumber_key" ON "Revision"("quoteId", "publishedNumber");
