-- CreateEnum
CREATE TYPE "EhrRecordType" AS ENUM ('COMMUNICATION', 'OBSERVATION', 'FOLLOW_UP_TASK', 'ESCALATION_RECORD', 'ENCOUNTER_UPDATE');

-- CreateTable
CREATE TABLE "EhrSyncRecord" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "EhrRecordType" NOT NULL,
    "payload" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EhrSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EhrSyncRecord_hospitalId_patientId_idx" ON "EhrSyncRecord"("hospitalId", "patientId");
