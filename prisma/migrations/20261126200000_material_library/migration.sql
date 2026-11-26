-- CreateTable
CREATE TABLE "LibraryMaterial" (
    "id" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryMaterial_maker_collection_idx" ON "LibraryMaterial"("maker", "collection");
