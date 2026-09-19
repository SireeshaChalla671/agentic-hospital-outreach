import axios from "axios";

const API_BASE = "http://localhost:4000/api";

export const api = axios.create({ baseURL: API_BASE });

// Attach JWT token to every request if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  hospitalId: string | null;
}

export async function login(email: string, password: string) {
  const res = await api.post("/auth/login", { email, password });
  localStorage.setItem("token", res.data.token);
  localStorage.setItem("user", JSON.stringify(res.data.user));
  return res.data.user as User;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}