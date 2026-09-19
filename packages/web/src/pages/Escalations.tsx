import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../api";

interface Escalation {
  id: string;
  status: string;
  classification: string;
  triggerReason: string;
  createdAt: string;
  patient: { firstName: string; lastName: string; mrn: string };
  campaign: { name: string };
}

interface EscalationDetail extends Escalation {
  call: {
    transcript: { speaker: string; text: string }[];
    documentation: string;
  } | null;
  evidence: any;
}

export default function Escalations() {
  const user = getCurrentUser();
  const [list, setList] = useState<Escalation[]>([]);
  const [selected, setSelected] = useState<EscalationDetail | null>(null);
  const [resolution, setResolution] = useState("");

  async function loadList() {
    if (!user?.hospitalId) return;
    const res = await api.get("/escalations", { params: { hospitalId: user.hospitalId } });
    setList(res.data);
  }

  async function openDetail(id: string) {
    const res = await api.get(`/escalations/${id}`);
    setSelected(res.data);
    setResolution("");
  }

  async function handleResolve() {
    if (!selected || !resolution.trim()) return;
    await api.post(`/escalations/${selected.id}/resolve`, { resolution });
    setSelected(null);
    loadList();
  }

  useEffect(() => { loadList(); }, []);

  return (
    <div>
      <h1>Escalations</h1>

      {!selected && (
        <div className="card">
          <table>
            <thead>
              <tr><th>Patient</th><th>Classification</th><th>Status</th><th>Campaign</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td>{e.patient.firstName} {e.patient.lastName} ({e.patient.mrn})</td>
                  <td><span className={`badge ${e.classification}`}>{e.classification}</span></td>
                  <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                  <td>{e.campaign.name}</td>
                  <td><button onClick={() => openDetail(e.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p style={{ color: "#64748b" }}>No escalations found.</p>}
        </div>
      )}

      {selected && (
        <div>
          <button onClick={() => setSelected(null)} style={{ marginBottom: 16, background: "#64748b" }}>
            ← Back to list
          </button>

          <div className="card">
            <h3>{selected.patient.firstName} {selected.patient.lastName} — {selected.patient.mrn}</h3>
            <p><span className={`badge ${selected.classification}`}>{selected.classification}</span>{" "}
               <span className={`badge ${selected.status}`}>{selected.status}</span></p>
            <p><strong>Trigger reason:</strong> {selected.triggerReason}</p>
          </div>

          {selected.call && (
            <div className="card">
              <h3>Conversation Transcript</h3>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {selected.call.transcript?.map((t, i) => (
                  <p key={i} style={{ margin: "6px 0" }}>
                    <strong>{t.speaker === "agent" ? "Agent" : "Patient"}:</strong> {t.text}
                  </p>
                ))}
              </div>
              <h3 style={{ marginTop: 20 }}>AI Documentation</h3>
              <p>{selected.call.documentation}</p>
            </div>
          )}

          {selected.status !== "RESOLVED" && selected.status !== "CLOSED" && (
            <div className="card">
              <h3>Resolve Escalation</h3>
              <textarea
                rows={4}
                placeholder="Enter clinical resolution notes..."
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
              <button onClick={handleResolve} style={{ marginTop: 10 }}>Resolve</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}