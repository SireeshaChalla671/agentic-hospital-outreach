import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";

interface HospitalDashboard {
  hospitalId: string;
  totalPatients: number;
  totalCampaigns: number;
  activeCampaigns: number;
  campaigns: { id: string; name: string; status: string; priority: number }[];
  escalationsByStatus: { status: string; count: number }[];
  openEscalations: number;
  callOutcomeBreakdown: { outcome: string; count: number }[];
  ehrSyncFailures: number;
}

export default function Dashboard() {
  const user = getCurrentUser();
  const [data, setData] = useState<HospitalDashboard | null>(null);
  const [hospitals, setHospitals] = useState<{ id: string; name: string }[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<string>(user?.hospitalId || "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHospitals() {
      if (user?.role === "PLATFORM_ADMIN") {
        const res = await api.get("/hospitals");
        setHospitals(res.data);
        if (res.data.length > 0 && !selectedHospital) setSelectedHospital(res.data[0].id);
      }
    }
    loadHospitals();
  }, []);

  useEffect(() => {
    async function loadDashboard() {
      if (!selectedHospital) return;
      setLoading(true);
      try {
        const res = await api.get(`/dashboards/hospital/${selectedHospital}`);
        setData(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, [selectedHospital]);

  return (
    <div>
      <h1>Hospital Dashboard</h1>

      {user?.role === "PLATFORM_ADMIN" && (
        <div style={{ marginBottom: 20, maxWidth: 320 }}>
          <label>Hospital</label>
          <select value={selectedHospital} onChange={(e) => setSelectedHospital(e.target.value)}>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading && <p>Loading...</p>}

      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-box">
              <div className="value">{data.totalPatients}</div>
              <div className="label">Total Patients</div>
            </div>
            <div className="stat-box">
              <div className="value">{data.activeCampaigns} / {data.totalCampaigns}</div>
              <div className="label">Active Campaigns</div>
            </div>
            <div className="stat-box">
              <div className="value">{data.openEscalations}</div>
              <div className="label">Open Escalations</div>
            </div>
            <div className="stat-box">
              <div className="value">{data.ehrSyncFailures}</div>
              <div className="label">EHR Sync Failures</div>
            </div>
          </div>

          <div className="card">
            <h3>Campaigns</h3>
            <table>
              <thead>
                <tr><th>Name</th><th>Status</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td>{c.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Call Outcomes</h3>
            <table>
              <thead><tr><th>Outcome</th><th>Count</th></tr></thead>
              <tbody>
                {data.callOutcomeBreakdown.map((c) => (
                  <tr key={c.outcome}>
                    <td><span className={`badge ${c.outcome}`}>{c.outcome}</span></td>
                    <td>{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Escalations by Status</h3>
            <table>
              <thead><tr><th>Status</th><th>Count</th></tr></thead>
              <tbody>
                {data.escalationsByStatus.map((e) => (
                  <tr key={e.status}>
                    <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                    <td>{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}