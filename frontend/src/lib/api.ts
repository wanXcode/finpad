// In production, API calls go through Next.js proxy route to avoid CORS/firewall issues
const API_BASE = "";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const token =
    typeof window !== "undefined" ? localStorage.getItem("finpad_token") : null;

  const res = await fetch(`${API_BASE}/api/proxy${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("finpad_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `API Error: ${res.status}`);
  }

  return res.json();
}

export function setToken(token: string) {
  localStorage.setItem("finpad_token", token);
}

export function getToken() {
  return typeof window !== "undefined"
    ? localStorage.getItem("finpad_token")
    : null;
}

export function clearToken() {
  localStorage.removeItem("finpad_token");
}

export type UserInfo = {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "user";
};

export async function getCurrentUser(): Promise<UserInfo> {
  return api<UserInfo>("/api/auth/me");
}

export async function checkRegistrationOpen(): Promise<boolean> {
  try {
    const res = await fetch("/api/proxy/api/auth/registration-status");
    const data = await res.json();
    return data.allow_registration === true;
  } catch {
    return false;
  }
}

export function setupTokenRefresh() {
  // Check token expiry every 30 minutes, refresh if < 2h remaining
  setInterval(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      const exp = payload.exp * 1000;
      const remaining = exp - Date.now();
      if (remaining < 2 * 60 * 60 * 1000 && remaining > 0) {
        const res = await api<{ access_token: string }>("/api/auth/refresh", {
          method: "POST",
        });
        setToken(res.access_token);
      }
    } catch {
      // ignore refresh errors
    }
  }, 30 * 60 * 1000);
}
