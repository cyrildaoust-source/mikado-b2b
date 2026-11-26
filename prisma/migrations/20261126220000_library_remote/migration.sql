-- Matières dont la photo reste chez l'éditeur (Dedar) : pas de copie en base.
ALTER TABLE "LibraryMaterial" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "LibraryMaterial" ADD COLUMN "remote" TEXT;
