-- CreateTable
CREATE TABLE "QuoteShare" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteShare_tokenHash_key" ON "QuoteShare"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteShare_quoteId_idx" ON "QuoteShare"("quoteId");

-- AddForeignKey
ALTER TABLE "QuoteShare" ADD CONSTRAINT "QuoteShare_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteShare" ADD CONSTRAINT "QuoteShare_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
