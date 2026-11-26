-- Fiche du cabinet de l'architecte : identité de ses propositions client.
CREATE TABLE "FirmProfile" (
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "vat" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "logoMime" TEXT,
    "logo" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirmProfile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "FirmProfile" ADD CONSTRAINT "FirmProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
