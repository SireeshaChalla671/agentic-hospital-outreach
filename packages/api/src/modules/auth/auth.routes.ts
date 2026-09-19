import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../lib/prisma";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(["PLATFORM_ADMIN", "HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "CLINICAL_REVIEWER"]),
  hospitalId: z.string().uuid().optional(),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { email, password, name, role, hospitalId } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, passwordHash, name, role, hospitalId: hospitalId ?? null },
  });

  const token = jwt.sign(
    { id: user.id, hospitalId: user.hospitalId, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: "12h" }
  );

  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, hospitalId: user.hospitalId },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, hospitalId: user.hospitalId, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, hospitalId: user.hospitalId },
  });
});

export default router;