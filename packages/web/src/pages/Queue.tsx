import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";

interface QueueState {
  hospitalId: string;
  outboundCapacity: number;
  activeCalls: number;
  statusBreakdown: { status: string; count: number }[];
  oldestPendingTaskAge: string | null;
  tasksNearCutoff: number;
}

export default function Queue() {
  const user = getCurrentUser();
  const [state, setState] = useState<QueueState | null>(null);
  const hospitalId = user?.hospitalId;

  async function load() {
    if (!hospitalId) return;
    const res = await api.get(`/queue/${hospitalId}/state`);
    setState(res.data);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // auto-refresh every 5s
    return () => clearInterval(interval);
  }, [hospitalId]);

  if (!hospitalId) {
    return <p>Queue view requires a hospital-scoped account.</p>;
  }

  return (
    <div>
      <h1>Live Queue State</h1>
      <p style={{ color: "#64748b", fontSize: 13 }}>Auto-refreshes every 5 seconds</p>

      {state && (
        <>
          <div className="stat-grid">
            <div className="stat-box">
              <div className="value">{state.activeCalls} / {state.outboundCapacity}</div>
              <div className="label">Active Calls / Capacity</div>
            </div>
            <div className="stat-box">
              <div className="value">{state.oldestPendingTaskAge || "—"}</div>
              <div className="label">Oldest Pending Task</div>
            </div>
            <div className="stat-box">
              <div className="value">{state.tasksNearCutoff}</div>
              <div className="label">Tasks Near Cutoff</div>
            </div>
          </div>

          <div className="card">
            <h3>Task Status Breakdown</h3>
            <table>
              <thead><tr><th>Status</th><th>Count</th></tr></thead>
              <tbody>
                {state.statusBreakdown.map((s) => (
                  <tr key={s.status}>
                    <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                    <td>{s.count}</td>
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