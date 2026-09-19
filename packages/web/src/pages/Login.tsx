import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";

export default function Login() {
  const [email, setEmail] = useState("admin@platform.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Login failed");
    }
  }

    return (
    <div className="login-page">
    <div className="login-box">
      <h1>Hospital Outreach Platform</h1>
      <p style={{ color: "#64748b", fontSize: 14 }}>Sign in to continue</p>
      <form onSubmit={handleSubmit}>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
        <button style={{ marginTop: 16, width: "100%" }} type="submit">Sign In</button>
      </form>
            <p className="demo-hint">
        Demo: admin@platform.com / password123
      </p>
    </div>
    </div>
  );
}