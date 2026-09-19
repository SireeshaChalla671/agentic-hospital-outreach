import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";

interface Campaign {
  id: string;
  name: string;
  status: string;
  priority: number;
  maxRetries: number;
}

export default function Campaigns() {
  const user = getCurrentUser();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = user?.role === "PLATFORM_ADMIN" && user?.hospitalId ? { hospitalId: user.hospitalId } : {};
    const res = await api.get("/campaigns", { params });
    setCampaigns(res.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(id: string, action: string) {
    await api.post(`/campaigns/${id}/${action}`);
    load();
  }

  return (
    <div>
      <h1>Campaigns</h1>
      <div className="card">
        {loading && <p>Loading...</p>}
        <table>
          <thead>
            <tr><th>Name</th><th>Status</th><th>Priority</th><th>Max Retries</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                <td>{c.priority}</td>
                <td>{c.maxRetries}</td>
                <td>
                  {(c.status === "DRAFT" || c.status === "READY" || c.status === "PAUSED") && (
                    <button onClick={() => handleAction(c.id, "activate")} style={{ marginRight: 6 }}>
                      Activate
                    </button>
                  )}
                  {c.status === "RUNNING" && (
                    <button onClick={() => handleAction(c.id, "pause")} style={{ background: "#dc2626" }}>
                      Pause
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}