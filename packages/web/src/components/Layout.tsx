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
                <div className="sidebar-footer">
          <div className="user-name">{user?.name}</div>
          <div>{user?.role}</div>
          <button onClick={handleLogout}>Log out</button>
        </div>
      </div>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}