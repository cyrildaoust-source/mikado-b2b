-- CreateTable
CREATE TABLE "QuoteDecision" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "shareId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "choices" TEXT NOT NULL,
    "remark" TEXT NOT NULL DEFAULT '',
    "clientFirstName" TEXT NOT NULL,
    "clientLastName" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedIp" TEXT NOT NULL DEFAULT '',
    "acceptedAgent" TEXT NOT NULL DEFAULT '',
    "net" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "gross" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "architectName" TEXT,
    "architectUserId" INTEGER,
    "architectSignedAt" TIMESTAMP(3),
    "billing" TEXT,
    "remindedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "invoicedById" INTEGER,
    "reopenedAt" TIMESTAMP(3),

    CONSTRAINT "QuoteDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteDecision_quoteId_idx" ON "QuoteDecision"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteDecision_status_idx" ON "QuoteDecision"("status");

-- AddForeignKey
ALTER TABLE "QuoteDecision" ADD CONSTRAINT "QuoteDecision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteDecision" ADD CONSTRAINT "QuoteDecision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

