-- Classes d'architectes : remise et palier de chiffre.
CREATE TABLE "ArchitectClass" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectClass_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "classId" INTEGER;

ALTER TABLE "User" ADD CONSTRAINT "User_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ArchitectClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
