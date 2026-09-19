import { Link, Outlet, useNavigate } from "react-router-dom";
import { getCurrentUser, logout } from "../api";

export default function Layout() {
  const user = getCurrentUser();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h2>Outreach Platform</h2>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/campaigns">Campaigns</Link>
          <Link to="/queue">Queue</Link>
          <Link to="/escalations">Escalations</Link>
        </nav>
        <div style={{ marginTop: 40, fontSize: 12, color: "#94a3b8" }}>
          <div>{user?.name}</div>
          <div>{user?.role}</div>
          <button onClick={handleLogout} style={{ marginTop: 10, background: "#334155" }}>
            Log out
          </button>
        </div>
      </div>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}