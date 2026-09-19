import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  id: string;
  hospitalId: string | null;
  role: "PLATFORM_ADMIN" | "HOSPITAL_ADMIN" | "CAMPAIGN_MANAGER" | "CLINICAL_REVIEWER";
}

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Restricts an endpoint to specific roles
export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// Enforces tenant isolation: non-platform-admins can only access their own hospital's data.
// Expects the target hospitalId to be resolvable from req.params.hospitalId or req.body.hospitalId
export function requireTenantMatch(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role === "PLATFORM_ADMIN") {
    return next(); // platform admin can cross tenants, but should still be checked per-endpoint for sensitive data
  }

  const targetHospitalId = req.params.hospitalId || req.body?.hospitalId;

  if (targetHospitalId && targetHospitalId !== req.user.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  next();
}