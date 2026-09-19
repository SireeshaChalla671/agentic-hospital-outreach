import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./modules/auth/auth.routes";
import hospitalRoutes from "./modules/hospitals/hospitals.routes";
import patientRoutes from "./modules/patients/patients.routes";
import campaignRoutes from "./modules/campaigns/campaigns.routes";
import queueRoutes from "./modules/queue/queue.routes";
import callRoutes from "./modules/calls/calls.routes";
import escalationRoutes from "./modules/escalations/escalations.routes";
import ehrRoutes from "./modules/ehr/ehr.routes";
import dashboardRoutes from "./modules/dashboards/dashboards.routes";
import notificationRoutes from "./modules/notifications/notifications.routes";
import healthRoutes from "./modules/health/health.routes";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/escalations", escalationRoutes);
app.use("/api/ehr", ehrRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/health", healthRoutes);
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});