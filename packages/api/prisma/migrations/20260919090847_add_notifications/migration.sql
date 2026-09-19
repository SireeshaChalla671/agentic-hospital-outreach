-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "escalationId" TEXT,
    "recipientRole" TEXT,
    "recipientUserId" TEXT,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_hospitalId_createdAt_idx" ON "Notification"("hospitalId", "createdAt");
