-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'architect',
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrandSetting" (
    "vendor" TEXT NOT NULL PRIMARY KEY,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "includeDrafts" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BillingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "netAmount" INTEGER,
    "taxAmount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "invoiceId" INTEGER,
    "invoiceNumber" TEXT,
    "invoiceState" TEXT,
    "paymentState" TEXT,
    "residual" INTEGER,
    "partnerId" INTEGER,
    "authorizedBy" TEXT,
    "authorizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "milestoneConfirmedAt" DATETIME,
    "error" TEXT,
    "syncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BillingRequest" ("amount", "authorizedAt", "authorizedBy", "createdAt", "currency", "error", "id", "invoiceId", "invoiceNumber", "invoiceState", "kind", "milestoneConfirmedAt", "netAmount", "partnerId", "paymentState", "quoteId", "residual", "status", "syncedAt", "taxAmount", "updatedAt") SELECT "amount", "authorizedAt", "authorizedBy", "createdAt", "currency", "error", "id", "invoiceId", "invoiceNumber", "invoiceState", "kind", "milestoneConfirmedAt", "netAmount", "partnerId", "paymentState", "quoteId", "residual", "status", "syncedAt", "taxAmount", "updatedAt" FROM "BillingRequest";
DROP TABLE "BillingRequest";
ALTER TABLE "new_BillingRequest" RENAME TO "BillingRequest";
CREATE INDEX "BillingRequest_status_updatedAt_idx" ON "BillingRequest"("status", "updatedAt");
CREATE UNIQUE INDEX "BillingRequest_quoteId_kind_key" ON "BillingRequest"("quoteId", "kind");
CREATE TABLE "new_Quote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" INTEGER,
    CONSTRAINT "Quote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("createdAt", "customer", "id", "number", "shop", "state", "status", "title", "updatedAt", "version") SELECT "createdAt", "customer", "id", "number", "shop", "state", "status", "title", "updatedAt", "version" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");
CREATE INDEX "Quote_shop_updatedAt_idx" ON "Quote"("shop", "updatedAt");
CREATE INDEX "Quote_ownerId_idx" ON "Quote"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

