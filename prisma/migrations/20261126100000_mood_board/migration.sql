-- CreateTable
CREATE TABLE "MoodBoard" (
    "quoteId" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoodBoard_pkey" PRIMARY KEY ("quoteId")
);

-- CreateTable
CREATE TABLE "MoodImage" (
    "id" TEXT NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoodImage_quoteId_idx" ON "MoodImage"("quoteId");

-- AddForeignKey
ALTER TABLE "MoodBoard" ADD CONSTRAINT "MoodBoard_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodImage" ADD CONSTRAINT "MoodImage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

