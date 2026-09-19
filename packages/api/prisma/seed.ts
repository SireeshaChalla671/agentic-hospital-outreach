import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CONDITIONS_POOL = [
  "Hypertension", "Type 2 Diabetes", "Congestive Heart Failure", "COPD",
  "Post-cardiac surgery", "Pneumonia", "Sepsis (resolved)", "Hip replacement",
  "Stroke recovery", "Chronic Kidney Disease", "Atrial Fibrillation", "Asthma",
];

const MEDICATIONS_POOL = [
  "Lisinopril", "Metformin", "Warfarin", "Furosemide", "Albuterol",
  "Atorvastatin", "Insulin", "Amoxicillin", "Prednisone", "Metoprolol",
];

const CARE_SETTINGS = ["Cardiology", "General Medicine", "Orthopedics", "Pulmonology", "Nephrology", "Emergency"];

function randomFrom<T>(arr: T[], count = 1): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function weightedRisk(): "low" | "medium" | "high" {
  const r = Math.random();
  if (r < 0.5) return "low";
  if (r < 0.8) return "medium";
  return "high";
}

async function main() {
  console.log("Seeding database...");

  const hospitalNames = ["General City Hospital", "Riverside Medical Center", "Lakeside Regional Hospital"];
  const hospitals = [];

  for (const name of hospitalNames) {
    const hospital = await prisma.hospital.create({
      data: {
        name,
        timezone: "America/New_York",
        status: "READY",
        outboundCapacity: faker.number.int({ min: 5, max: 15 }),
        callingHoursStart: "09:00",
        callingHoursEnd: "18:00",
        contactEmail: faker.internet.email(),
      },
    });
    hospitals.push(hospital);
    console.log(`Created hospital: ${hospital.name} (${hospital.id})`);
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  await prisma.user.upsert({
    where: { email: "admin@platform.com" },
    update: {},
    create: {
      email: "admin@platform.com",
      passwordHash,
      name: "Platform Admin",
      role: "PLATFORM_ADMIN",
    },
  });

  for (const hospital of hospitals) {
    const slug = hospital.name.toLowerCase().replace(/[^a-z]+/g, ".");

    await prisma.user.create({
      data: {
        email: `hospitaladmin@${slug}.com`,
        passwordHash,
        name: `${hospital.name} Admin`,
        role: "HOSPITAL_ADMIN",
        hospitalId: hospital.id,
      },
    });

    await prisma.user.create({
      data: {
        email: `campaignmanager@${slug}.com`,
        passwordHash,
        name: `${hospital.name} Campaign Manager`,
        role: "CAMPAIGN_MANAGER",
        hospitalId: hospital.id,
      },
    });

    await prisma.user.create({
      data: {
        email: `reviewer@${slug}.com`,
        passwordHash,
        name: `${hospital.name} Clinical Reviewer`,
        role: "CLINICAL_REVIEWER",
        hospitalId: hospital.id,
      },
    });
  }

  console.log("Created users for each hospital (password: password123)");

  const protocolTemplates = [
    {
      title: "Post-Cardiac Discharge Protocol",
      category: "cardiac",
      content: "Ask about chest pain, shortness of breath, swelling in legs, weight gain >2lbs/day, and medication adherence.",
      redFlags: ["chest pain", "severe shortness of breath", "fainting", "rapid weight gain"],
    },
    {
      title: "Post-Surgical Wound Care Protocol",
      category: "post-surgical",
      content: "Ask about wound appearance, fever, increasing pain, drainage, and mobility.",
      redFlags: ["fever above 101F", "wound discharge", "increasing redness", "wound opening"],
    },
    {
      title: "Diabetes Management Protocol",
      category: "diabetes",
      content: "Ask about blood sugar readings, medication adherence, diet, and signs of hypo/hyperglycemia.",
      redFlags: ["blood sugar below 70", "blood sugar above 300", "confusion", "loss of consciousness"],
    },
    {
      title: "Respiratory Follow-up Protocol",
      category: "respiratory",
      content: "Ask about breathing difficulty, oxygen use, cough, and inhaler use.",
      redFlags: ["severe difficulty breathing", "blue lips or fingertips", "unable to speak full sentences"],
    },
  ];

  for (const hospital of hospitals) {
    for (const p of protocolTemplates) {
      await prisma.protocol.create({
        data: { ...p, hospitalId: hospital.id },
      });
    }
  }

  console.log("Created protocols for each hospital");

  const TOTAL_PATIENTS = 350;
  let mrnCounter = 1000;

  for (let i = 0; i < TOTAL_PATIENTS; i++) {
    const hospital = hospitals[i % hospitals.length];
    const risk = weightedRisk();

    const hoursAgo = faker.number.int({ min: 1, max: 120 });
    const dischargeTimestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const followUpWindowHours = risk === "high" ? 24 : risk === "medium" ? 48 : 72;

    await prisma.patient.create({
      data: {
        hospitalId: hospital.id,
        mrn: `MRN-${mrnCounter++}`,
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        phone: faker.phone.number(),
        preferredContactTime: randomFrom(["morning", "afternoon", "evening"])[0],
        encounters: {
          create: {
            careSetting: randomFrom(CARE_SETTINGS)[0],
            dischargeTimestamp,
            followUpWindowHours,
            conditions: randomFrom(CONDITIONS_POOL, faker.number.int({ min: 1, max: 3 })),
            medications: randomFrom(MEDICATIONS_POOL, faker.number.int({ min: 0, max: 3 })),
            riskLevel: risk,
            instructions: "Follow discharge instructions and monitor symptoms as discussed.",
          },
        },
      },
    });

    if (i % 50 === 0) console.log(`  ...created ${i + 1}/${TOTAL_PATIENTS} patients`);
  }

  console.log(`Created ${TOTAL_PATIENTS} patients across ${hospitals.length} hospitals`);
  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });