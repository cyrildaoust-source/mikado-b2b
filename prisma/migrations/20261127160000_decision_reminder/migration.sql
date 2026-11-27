-- CreateTable
CREATE TABLE "DecisionReminder" (
    "id" SERIAL NOT NULL,
    "decisionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionReminder_decisionId_kind_key" ON "DecisionReminder"("decisionId", "kind");

-- AddForeignKey
ALTER TABLE "DecisionReminder" ADD CONSTRAINT "DecisionReminder_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "QuoteDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

