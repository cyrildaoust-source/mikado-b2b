ALTER TABLE "Revision" ADD COLUMN "documentMeta" TEXT;
ALTER TABLE "Revision" ADD COLUMN "pdfGeneratedAt" DATETIME;
UPDATE "Revision" SET "pdfGeneratedAt" = "issuedAt" WHERE "pdf" IS NOT NULL AND "publishedNumber" IS NOT NULL;
CREATE TABLE "QuoteCounter" ("shop" TEXT NOT NULL, "year" INTEGER NOT NULL, "value" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("shop", "year"));
